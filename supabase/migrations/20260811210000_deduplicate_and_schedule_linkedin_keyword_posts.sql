alter table public.linkedin_keyword_posts
  add column if not exists source_post_id text,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists seen_count bigint;

update public.linkedin_keyword_posts
set source_post_id = coalesce(
  nullif(trim(raw_post ->> 'id'), ''),
  nullif(trim(raw_post ->> 'post_id'), ''),
  nullif(trim(raw_post ->> 'postId'), ''),
  'legacy_' || id::text
)
where source_post_id is null;

with ranked as (
  select
    id,
    keyword_id,
    source_post_id,
    row_number() over (
      partition by keyword_id, source_post_id
      order by scraped_at desc, id desc
    ) as row_rank,
    min(scraped_at) over (partition by keyword_id, source_post_id) as first_seen,
    max(scraped_at) over (partition by keyword_id, source_post_id) as last_seen,
    count(*) over (partition by keyword_id, source_post_id) as observations
  from public.linkedin_keyword_posts
), keepers as (
  select id, first_seen, last_seen, observations
  from ranked
  where row_rank = 1
)
update public.linkedin_keyword_posts posts
set
  first_seen_at = keepers.first_seen,
  last_seen_at = keepers.last_seen,
  seen_count = keepers.observations,
  scraped_at = keepers.last_seen
from keepers
where posts.id = keepers.id;

with ranked as (
  select
    id,
    row_number() over (
      partition by keyword_id, source_post_id
      order by scraped_at desc, id desc
    ) as row_rank
  from public.linkedin_keyword_posts
)
delete from public.linkedin_keyword_posts posts
using ranked
where posts.id = ranked.id
  and ranked.row_rank > 1;

alter table public.linkedin_keyword_posts
  alter column source_post_id set not null,
  alter column first_seen_at set default now(),
  alter column first_seen_at set not null,
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null,
  alter column seen_count set default 1,
  alter column seen_count set not null;

alter table public.linkedin_keyword_posts
  add constraint linkedin_keyword_posts_seen_count_positive check (seen_count > 0);

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.linkedin_keyword_posts'::regclass
      and constraint_row.contype = 'u'
      and exists (
        select 1
        from unnest(constraint_row.conkey) key_column(attnum)
        join pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key_column.attnum
        where attribute.attname = 'scrape_run_id'
      )
  loop
    execute format('alter table public.linkedin_keyword_posts drop constraint %I', constraint_name);
  end loop;
end;
$$;

create unique index if not exists idx_linkedin_keyword_posts_keyword_source_post
  on public.linkedin_keyword_posts (keyword_id, source_post_id);

create index if not exists idx_linkedin_keyword_posts_last_seen
  on public.linkedin_keyword_posts (last_seen_at desc);

create table if not exists public.linkedin_keyword_scrape_runs (
  scrape_run_id uuid not null,
  page integer not null check (page > 0),
  keyword_id uuid not null references public.linkedin_keywords (id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  posts_fetched bigint not null default 0 check (posts_fetched >= 0),
  unique_posts_seen bigint not null default 0 check (unique_posts_seen >= 0),
  harvest_cost numeric,
  status text not null default 'completed',
  primary key (scrape_run_id, page)
);

create index if not exists idx_linkedin_keyword_scrape_runs_keyword_completed
  on public.linkedin_keyword_scrape_runs (keyword_id, completed_at desc);

alter table public.linkedin_keyword_scrape_runs enable row level security;
revoke all on table public.linkedin_keyword_scrape_runs from anon, authenticated;
grant select, insert, update, delete on table public.linkedin_keyword_scrape_runs to service_role;

create or replace function public.upsert_linkedin_keyword_posts(p_posts jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.linkedin_keyword_posts (
    source_post_id,
    scrape_run_id,
    keyword_id,
    harvest_page,
    item_index,
    raw_post,
    scraped_at,
    first_seen_at,
    last_seen_at,
    seen_count
  )
  select
    item ->> 'source_post_id',
    (item ->> 'scrape_run_id')::uuid,
    (item ->> 'keyword_id')::uuid,
    (item ->> 'harvest_page')::integer,
    (item ->> 'item_index')::integer,
    item -> 'raw_post',
    coalesce((item ->> 'observed_at')::timestamptz, now()),
    coalesce((item ->> 'observed_at')::timestamptz, now()),
    coalesce((item ->> 'observed_at')::timestamptz, now()),
    greatest(coalesce((item ->> 'seen_increment')::bigint, 1), 1)
  from jsonb_array_elements(coalesce(p_posts, '[]'::jsonb)) item
  on conflict (keyword_id, source_post_id) do update
  set
    scrape_run_id = excluded.scrape_run_id,
    harvest_page = excluded.harvest_page,
    item_index = excluded.item_index,
    raw_post = excluded.raw_post,
    scraped_at = excluded.scraped_at,
    last_seen_at = excluded.last_seen_at,
    seen_count = public.linkedin_keyword_posts.seen_count
      + case
        when public.linkedin_keyword_posts.scrape_run_id = excluded.scrape_run_id then 0
        else excluded.seen_count
      end;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.record_linkedin_keyword_scrape_run(
  p_scrape_run_id uuid,
  p_keyword_id uuid,
  p_page integer,
  p_posts_fetched integer,
  p_unique_posts_seen integer,
  p_harvest_cost numeric default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.linkedin_keyword_scrape_runs (
    scrape_run_id,
    page,
    keyword_id,
    posts_fetched,
    unique_posts_seen,
    harvest_cost,
    completed_at
  ) values (
    p_scrape_run_id,
    greatest(coalesce(p_page, 1), 1),
    p_keyword_id,
    greatest(coalesce(p_posts_fetched, 0), 0),
    greatest(coalesce(p_unique_posts_seen, 0), 0),
    p_harvest_cost,
    now()
  )
  on conflict (scrape_run_id, page) do update
  set
    posts_fetched = excluded.posts_fetched,
    unique_posts_seen = excluded.unique_posts_seen,
    harvest_cost = excluded.harvest_cost,
    completed_at = now();
$$;

create or replace function public.claim_linkedin_keywords_for_scrape(
  p_keyword_ids uuid[],
  p_interval_hours numeric,
  p_force boolean default false
)
returns table (id uuid)
language sql
security definer
set search_path = public
as $$
  update public.linkedin_keywords keywords
  set
    last_scraped_at = now(),
    updated_at = now()
  where keywords.is_active = true
    and keywords.id = any(coalesce(p_keyword_ids, '{}'::uuid[]))
    and (
      coalesce(p_force, false)
      or keywords.last_scraped_at is null
      or keywords.last_scraped_at <= now() - make_interval(
        mins => greatest((coalesce(p_interval_hours, 1) * 60)::integer - 5, 1)
      )
    )
  returning keywords.id;
$$;

revoke all on function public.upsert_linkedin_keyword_posts(jsonb) from public;
grant execute on function public.upsert_linkedin_keyword_posts(jsonb) to service_role;
revoke all on function public.record_linkedin_keyword_scrape_run(uuid, uuid, integer, integer, integer, numeric) from public;
grant execute on function public.record_linkedin_keyword_scrape_run(uuid, uuid, integer, integer, integer, numeric) to service_role;
revoke all on function public.claim_linkedin_keywords_for_scrape(uuid[], numeric, boolean) from public;
grant execute on function public.claim_linkedin_keywords_for_scrape(uuid[], numeric, boolean) to service_role;

update public.linkedin_keyword_scraper_config
set
  schedule_interval_hours = 1,
  updated_at = now()
where id = true;