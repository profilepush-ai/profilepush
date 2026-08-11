alter table public.linkedin_group_scrape_runs
  add column if not exists page integer not null default 1 check (page > 0);

alter table public.linkedin_group_scrape_runs
  drop constraint if exists linkedin_group_scrape_runs_pkey;

alter table public.linkedin_group_scrape_runs
  add primary key (scrape_run_id, page);

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
    seen_count = public.linkedin_groups_posts.seen_count
      + case
        when public.linkedin_groups_posts.scrape_run_id = excluded.scrape_run_id then 0
        else excluded.seen_count
      end;

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
    page,
    group_id,
    page_count,
    posts_fetched,
    unique_posts_seen,
    harvest_cost,
    completed_at
  ) values (
    p_scrape_run_id,
    greatest(coalesce(p_page, 1), 1),
    p_group_id,
    greatest(coalesce(p_page, 1), 1),
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