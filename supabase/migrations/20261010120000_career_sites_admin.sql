/*
# Career sites: the list of sites we scrape, and a log of every run

- career_sites: one row per site. `kind` says how it is read:
    builtin         a hand-written adapter in the worker (slug picks it)
    sitemap_jsonld  job sitemap -> schema.org JobPosting on each job page
    jobdiva         a JobDiva candidate portal (config.portal_key)
    greenhouse      Greenhouse job board API (config.board)
    lever           Lever postings API (config.company)
    workday         Workday career site (config.url)
  The worker takes the enabled sites from here every hour, so sites can be
  added or switched off from /admin without a deploy.
- career_site_runs: what each run listed, found, fetched, stored and closed.
- career_sites_overview(): per-site counts for the admin page.
Service role only (the admin function and the import function use it).
*/

create table if not exists public.career_sites (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  kind text not null check (kind in ('builtin', 'sitemap_jsonld', 'jobdiva', 'greenhouse', 'lever', 'workday')),
  config jsonb not null default '{}'::jsonb,
  careers_url text,
  enabled boolean not null default true,
  max_new_per_run integer not null default 60 check (max_new_per_run between 1 and 300),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.career_sites enable row level security;

insert into public.career_sites (slug, name, kind, careers_url, notes) values
  ('teksystems', 'TEKsystems', 'builtin', 'https://careers.teksystems.com/us/en', 'Sitemap + job pages'),
  ('judge', 'Judge Group', 'builtin', 'https://www.judge.com/jobs/', 'Site''s own job search endpoint'),
  ('apex', 'Apex Systems', 'builtin', 'https://www.apexsystems.com/search-results-usa', 'Search listing + job pages'),
  ('kforce', 'Kforce', 'builtin', 'https://www.kforce.com/find-work/search-jobs/', 'Site''s search index (public key from its page)'),
  ('randstad', 'Randstad', 'builtin', 'https://www.randstadusa.com/jobs/', 'Data embedded in job pages'),
  ('insightglobal', 'Insight Global', 'builtin', 'https://insightglobal.com/jobs/', 'Site''s own job API'),
  ('pyramid', 'Pyramid Consulting', 'builtin', 'https://jobs.sprockets.ai/en-US/pyramidinc', 'Sprockets job board API'),
  ('diverselynx', 'Diverse Lynx', 'builtin', 'https://www.diverselynx.com/careers/', 'JobDiva portal (guest token)'),
  ('mindlance', 'Mindlance', 'builtin', 'https://mindlance.com/job-board/', 'JobDiva portal (guest token)')
on conflict (slug) do nothing;

create table if not exists public.career_site_runs (
  id bigserial primary key,
  slug text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  full_sync boolean not null default false,
  listed integer not null default 0,
  new_found integer not null default 0,
  non_it_found integer not null default 0,
  processed integer not null default 0,
  fetched integer not null default 0,
  failed integer not null default 0,
  accepted integer not null default 0,
  rejected integer not null default 0,
  closed integer not null default 0,
  error text
);
alter table public.career_site_runs enable row level security;
create index if not exists career_site_runs_slug_time_idx on public.career_site_runs (slug, started_at desc);
create index if not exists career_site_runs_time_idx on public.career_site_runs (started_at desc);

create or replace function public.career_sites_overview()
returns table (
  slug text, open_it bigint, open_non_it bigint, added_24h bigint, added_7d bigint,
  rejected_total bigint, runs_24h bigint, accepted_24h bigint, last_run_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.slug,
    count(j.id) filter (where j.post_status = 'open' and j.hidden_at is null and coalesce(j.job_category, 'IT') <> 'Non-IT'),
    count(j.id) filter (where j.post_status = 'open' and j.hidden_at is null and j.job_category = 'Non-IT'),
    count(j.id) filter (where j.created_at > now() - interval '24 hours'),
    count(j.id) filter (where j.created_at > now() - interval '7 days'),
    (select count(*) from career_site_jobs c where c.prime = s.slug and c.status = 'rejected'),
    (select count(*) from career_site_runs r where r.slug = s.slug and r.started_at > now() - interval '24 hours'),
    (select coalesce(sum(r.accepted), 0) from career_site_runs r where r.slug = s.slug and r.started_at > now() - interval '24 hours'),
    (select max(r.started_at) from career_site_runs r where r.slug = s.slug)
  from career_sites s
  left join social_jobs j on j.post_source = 'career_site' and j.post_id like s.slug || ':%'
  group by s.slug;
$$;
revoke all on function public.career_sites_overview() from public, anon, authenticated;
