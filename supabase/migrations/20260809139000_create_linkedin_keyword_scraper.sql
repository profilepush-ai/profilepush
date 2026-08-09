create table if not exists public.linkedin_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null check (char_length(btrim(keyword)) between 2 and 200),
  is_active boolean not null default true,
  last_scraped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_linkedin_keywords_keyword_unique
  on public.linkedin_keywords (lower(btrim(keyword)));

create index if not exists idx_linkedin_keywords_active
  on public.linkedin_keywords (is_active, keyword);

create table if not exists public.linkedin_keyword_scraper_config (
  id boolean primary key default true check (id),
  is_enabled boolean not null default false,
  max_pages integer not null default 1 check (max_pages between 1 and 20),
  max_posts_per_keyword integer not null default 100 check (max_posts_per_keyword between 1 and 1000),
  posted_limit text not null default '24h' check (posted_limit in ('24h', 'week', 'month')),
  sort_by text not null default 'relevance' check (sort_by in ('date', 'relevance')),
  schedule_interval_hours integer not null default 3 check (schedule_interval_hours between 1 and 24),
  last_scheduled_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.linkedin_keyword_scraper_config (id) values (true)
on conflict (id) do nothing;

create table if not exists public.linkedin_keyword_posts (
  id bigint generated always as identity primary key,
  scrape_run_id uuid not null,
  keyword_id uuid not null references public.linkedin_keywords (id) on delete cascade,
  harvest_page integer not null check (harvest_page > 0),
  item_index integer not null check (item_index >= 0),
  raw_post jsonb not null,
  scraped_at timestamptz not null default now(),
  unique (scrape_run_id, keyword_id, harvest_page, item_index)
);

create index if not exists idx_linkedin_keyword_posts_keyword_scraped
  on public.linkedin_keyword_posts (keyword_id, scraped_at desc);

create table if not exists public.linkedin_keyword_social_jobs (
  keyword_id uuid not null references public.linkedin_keywords (id) on delete cascade,
  social_job_id uuid not null references public.social_jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (keyword_id, social_job_id)
);

create index if not exists idx_linkedin_keyword_social_jobs_job
  on public.linkedin_keyword_social_jobs (social_job_id);

create or replace function public.get_linkedin_keyword_performance_stats(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table (
  keyword_id uuid,
  scraped_posts_count bigint,
  social_jobs_count bigint,
  radar_results_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with scraped as (
    select posts.keyword_id, count(*)::bigint as scraped_posts_count
    from public.linkedin_keyword_posts posts
    where (p_start is null or posts.scraped_at >= p_start)
      and (p_end is null or posts.scraped_at < p_end)
    group by posts.keyword_id
  ), jobs as (
    select links.keyword_id, count(*)::bigint as social_jobs_count
    from public.linkedin_keyword_social_jobs links
    join public.social_jobs jobs on jobs.id = links.social_job_id
    where (p_start is null or jobs.created_at >= p_start)
      and (p_end is null or jobs.created_at < p_end)
    group by links.keyword_id
  ), radar as (
    select links.keyword_id, count(matches.id)::bigint as radar_results_count
    from public.linkedin_keyword_social_jobs links
    join public.radar_match_results matches
      on matches.job_source = 'social'
     and matches.job_id = links.social_job_id
    where (p_start is null or matches.created_at >= p_start)
      and (p_end is null or matches.created_at < p_end)
    group by links.keyword_id
  )
  select
    keywords.id,
    coalesce(scraped.scraped_posts_count, 0),
    coalesce(jobs.social_jobs_count, 0),
    coalesce(radar.radar_results_count, 0)
  from public.linkedin_keywords keywords
  left join scraped on scraped.keyword_id = keywords.id
  left join jobs on jobs.keyword_id = keywords.id
  left join radar on radar.keyword_id = keywords.id
  order by keywords.keyword;
$$;

alter table public.linkedin_keywords enable row level security;
alter table public.linkedin_keyword_scraper_config enable row level security;
alter table public.linkedin_keyword_posts enable row level security;
alter table public.linkedin_keyword_social_jobs enable row level security;

revoke all on table public.linkedin_keywords from anon, authenticated;
revoke all on table public.linkedin_keyword_scraper_config from anon, authenticated;
revoke all on table public.linkedin_keyword_posts from anon, authenticated;
revoke all on table public.linkedin_keyword_social_jobs from anon, authenticated;
grant all on table public.linkedin_keywords to service_role;
grant select, insert, update on table public.linkedin_keyword_scraper_config to service_role;
grant select, insert, update, delete on table public.linkedin_keyword_posts to service_role;
grant select, insert, update, delete on table public.linkedin_keyword_social_jobs to service_role;
grant usage, select on sequence public.linkedin_keyword_posts_id_seq to service_role;
revoke all on function public.get_linkedin_keyword_performance_stats(timestamptz, timestamptz) from public;
grant execute on function public.get_linkedin_keyword_performance_stats(timestamptz, timestamptz) to service_role;