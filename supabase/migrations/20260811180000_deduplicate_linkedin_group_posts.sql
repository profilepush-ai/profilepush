alter table public.linkedin_groups_posts
  add column if not exists source_post_id text,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists seen_count bigint;

update public.linkedin_groups_posts
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
    source_post_id,
    row_number() over (partition by source_post_id order by scraped_at desc, id desc) as row_rank,
    min(scraped_at) over (partition by source_post_id) as first_seen,
    max(scraped_at) over (partition by source_post_id) as last_seen,
    count(*) over (partition by source_post_id) as observations
  from public.linkedin_groups_posts
), keepers as (
  select id, first_seen, last_seen, observations
  from ranked
  where row_rank = 1
)
update public.linkedin_groups_posts posts
set
  first_seen_at = keepers.first_seen,
  last_seen_at = keepers.last_seen,
  seen_count = keepers.observations,
  scraped_at = keepers.last_seen
from keepers
where posts.id = keepers.id;

with ranked as (
  select id, row_number() over (partition by source_post_id order by scraped_at desc, id desc) as row_rank
  from public.linkedin_groups_posts
)
delete from public.linkedin_groups_posts posts
using ranked
where posts.id = ranked.id
  and ranked.row_rank > 1;

alter table public.linkedin_groups_posts
  alter column source_post_id set not null,
  alter column first_seen_at set default now(),
  alter column first_seen_at set not null,
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null,
  alter column seen_count set default 1,
  alter column seen_count set not null;

alter table public.linkedin_groups_posts
  add constraint linkedin_groups_posts_seen_count_positive check (seen_count > 0);

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.linkedin_groups_posts'::regclass
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
    execute format('alter table public.linkedin_groups_posts drop constraint %I', constraint_name);
  end loop;
end;
$$;

create unique index if not exists idx_linkedin_groups_posts_source_post_id
  on public.linkedin_groups_posts (source_post_id);

create index if not exists idx_linkedin_groups_posts_last_seen
  on public.linkedin_groups_posts (last_seen_at desc);

create table if not exists public.linkedin_group_scrape_runs (
  scrape_run_id uuid primary key,
  group_id text not null references public.linkedin_groups (group_id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  page_count integer not null default 0 check (page_count >= 0),
  posts_fetched bigint not null default 0 check (posts_fetched >= 0),
  unique_posts_seen bigint not null default 0 check (unique_posts_seen >= 0),
  harvest_cost numeric,
  status text not null default 'completed'
);

create index if not exists idx_linkedin_group_scrape_runs_group_completed
  on public.linkedin_group_scrape_runs (group_id, completed_at desc);

alter table public.linkedin_group_scrape_runs enable row level security;
revoke all on table public.linkedin_group_scrape_runs from anon, authenticated;
grant select, insert, update, delete on table public.linkedin_group_scrape_runs to service_role;

create or replace function public.upsert_linkedin_group_posts(p_posts jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.linkedin_groups_posts (
    source_post_id,
    scrape_run_id,
    group_id,
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
    item ->> 'group_id',
    (item ->> 'harvest_page')::integer,
    (item ->> 'item_index')::integer,
    item -> 'raw_post',
    coalesce((item ->> 'observed_at')::timestamptz, now()),
    coalesce((item ->> 'observed_at')::timestamptz, now()),
    coalesce((item ->> 'observed_at')::timestamptz, now()),
    greatest(coalesce((item ->> 'seen_increment')::bigint, 1), 1)
  from jsonb_array_elements(coalesce(p_posts, '[]'::jsonb)) item
  on conflict (source_post_id) do update
  set
    scrape_run_id = excluded.scrape_run_id,
    group_id = excluded.group_id,
    harvest_page = excluded.harvest_page,
    item_index = excluded.item_index,
    raw_post = excluded.raw_post,
    scraped_at = excluded.scraped_at,
    last_seen_at = excluded.last_seen_at,
    seen_count = public.linkedin_groups_posts.seen_count + excluded.seen_count;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.record_linkedin_group_scrape_run(
  p_scrape_run_id uuid,
  p_group_id text,
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
  insert into public.linkedin_group_scrape_runs (
    scrape_run_id,
    group_id,
    page_count,
    posts_fetched,
    unique_posts_seen,
    harvest_cost,
    completed_at
  ) values (
    p_scrape_run_id,
    p_group_id,
    greatest(coalesce(p_page, 1), 1),
    greatest(coalesce(p_posts_fetched, 0), 0),
    greatest(coalesce(p_unique_posts_seen, 0), 0),
    p_harvest_cost,
    now()
  )
  on conflict (scrape_run_id) do update
  set
    page_count = greatest(public.linkedin_group_scrape_runs.page_count, excluded.page_count),
    posts_fetched = public.linkedin_group_scrape_runs.posts_fetched + excluded.posts_fetched,
    unique_posts_seen = public.linkedin_group_scrape_runs.unique_posts_seen + excluded.unique_posts_seen,
    harvest_cost = coalesce(public.linkedin_group_scrape_runs.harvest_cost, 0) + coalesce(excluded.harvest_cost, 0),
    completed_at = now();
$$;

create or replace view public.linkedin_group_performance_stats
with (security_invoker = true)
as
with scraped as (
  select group_id, count(*)::bigint as scraped_posts_count
  from public.linkedin_groups_posts
  group by group_id
), jobs as (
  select group_id, count(*)::bigint as social_jobs_count
  from public.social_jobs
  where platform = 'linkedin' and group_id is not null
  group by group_id
), radar as (
  select social.group_id, count(matches.id)::bigint as radar_results_count
  from public.social_jobs social
  join public.radar_match_results matches
    on matches.job_source = 'social'
   and matches.job_id = social.id
  where social.platform = 'linkedin' and social.group_id is not null
  group by social.group_id
)
select
  groups.group_id,
  coalesce(scraped.scraped_posts_count, 0)::bigint as scraped_posts_count,
  coalesce(jobs.social_jobs_count, 0)::bigint as social_jobs_count,
  coalesce(radar.radar_results_count, 0)::bigint as radar_results_count
from public.linkedin_groups groups
left join scraped on scraped.group_id = groups.group_id
left join jobs on jobs.group_id = groups.group_id
left join radar on radar.group_id = groups.group_id;

create or replace function public.get_linkedin_group_performance_stats(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table (
  group_id text,
  scraped_posts_count bigint,
  social_jobs_count bigint,
  radar_results_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with scraped as (
    select posts.group_id, count(*)::bigint as scraped_posts_count
    from public.linkedin_groups_posts posts
    where (p_start is null or posts.first_seen_at >= p_start)
      and (p_end is null or posts.first_seen_at < p_end)
    group by posts.group_id
  ), jobs as (
    select social.group_id, count(*)::bigint as social_jobs_count
    from public.social_jobs social
    where social.platform = 'linkedin'
      and social.group_id is not null
      and (p_start is null or social.created_at >= p_start)
      and (p_end is null or social.created_at < p_end)
    group by social.group_id
  ), radar as (
    select social.group_id, count(matches.id)::bigint as radar_results_count
    from public.social_jobs social
    join public.radar_match_results matches
      on matches.job_source = 'social'
     and matches.job_id = social.id
    where social.platform = 'linkedin'
      and social.group_id is not null
      and (p_start is null or matches.created_at >= p_start)
      and (p_end is null or matches.created_at < p_end)
    group by social.group_id
  )
  select
    groups.group_id,
    coalesce(scraped.scraped_posts_count, 0)::bigint,
    coalesce(jobs.social_jobs_count, 0)::bigint,
    coalesce(radar.radar_results_count, 0)::bigint
  from public.linkedin_groups groups
  left join scraped on scraped.group_id = groups.group_id
  left join jobs on jobs.group_id = groups.group_id
  left join radar on radar.group_id = groups.group_id;
$$;

revoke all on function public.upsert_linkedin_group_posts(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_linkedin_group_posts(jsonb) to service_role;
revoke all on function public.record_linkedin_group_scrape_run(uuid, text, integer, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.record_linkedin_group_scrape_run(uuid, text, integer, integer, integer, numeric) to service_role;