create table if not exists public.social_hotlist (
  id uuid primary key default gen_random_uuid(),
  source_post_id text not null,
  candidate_index integer not null check (candidate_index >= 0),
  platform text not null,
  group_id text not null default '',
  posted_at timestamptz,
  post_url text not null default '',
  raw_post_content text not null,
  bench_sales_recruiter_name text not null default '',
  bench_sales_recruiter_email text not null default '',
  bench_sales_recruiter_phone text not null default '',
  bench_sales_company_name text not null default '',
  recruiter_profile_link text not null default '',
  candidate_name text not null default '',
  role_title text not null,
  core_skills text[] not null default '{}',
  years_experience numeric,
  visa_type text not null default '',
  employment_type text not null default '',
  work_type text not null default '',
  locations text[] not null default '{}',
  hourly_rate_min numeric,
  hourly_rate_max numeric,
  availability text not null default '',
  candidate_summary text not null default '',
  classification_confidence numeric check (classification_confidence between 0 and 1),
  extracted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (platform, source_post_id, candidate_index)
);

create index if not exists idx_social_hotlist_posted_at
  on public.social_hotlist (posted_at desc nulls last, created_at desc);
create index if not exists idx_social_hotlist_role_title
  on public.social_hotlist (lower(role_title));
create index if not exists idx_social_hotlist_recruiter_email
  on public.social_hotlist (lower(bench_sales_recruiter_email))
  where bench_sales_recruiter_email <> '';

alter table public.social_hotlist enable row level security;
grant select on public.social_hotlist to authenticated, service_role;
grant insert, update, delete on public.social_hotlist to service_role;

drop policy if exists authenticated_read_social_hotlist on public.social_hotlist;
create policy authenticated_read_social_hotlist
  on public.social_hotlist for select to authenticated using (true);

create table if not exists public.radar_match_hotlist (
  id uuid primary key default gen_random_uuid(),
  hotlist_id uuid not null references public.social_hotlist(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  final_average_score numeric not null default 0,
  score_breakdown jsonb not null default '{}'::jsonb,
  role_title text not null default '',
  core_skills text[] not null default '{}',
  years_experience numeric,
  visa_types text[] not null default '{}',
  employment_type text not null default '',
  work_type text not null default '',
  locations text[] not null default '{}',
  hourly_rate_min numeric,
  hourly_rate_max numeric,
  extracted_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (hotlist_id)
);

create index if not exists idx_radar_match_hotlist_created_at
  on public.radar_match_hotlist (created_at desc);

alter table public.radar_match_hotlist enable row level security;
grant select on public.radar_match_hotlist to authenticated, service_role;
grant insert, update, delete on public.radar_match_hotlist to service_role;

drop policy if exists authenticated_read_radar_match_hotlist on public.radar_match_hotlist;
create policy authenticated_read_radar_match_hotlist
  on public.radar_match_hotlist for select to authenticated using (true);

create or replace function public.get_social_hotlist_feed_page(
  p_since timestamptz,
  p_before_posted_at timestamptz default null,
  p_before_lead_id text default null,
  p_limit integer default 1000
)
returns table (
  lead_id text,
  profile_id uuid,
  match_created_at timestamptz,
  final_average_score double precision,
  score_breakdown jsonb,
  platform text,
  posted_by_name text,
  poster_email text,
  poster_phone text,
  social_created_at timestamptz,
  posted_at timestamptz,
  effective_posted_at timestamptz,
  job_title text,
  company_name text,
  location text,
  post_content text,
  extracted_role_normalized text,
  employment_type text,
  seniority_level text,
  salary_range text,
  extracted_skills text[],
  extracted_experience_years integer,
  extracted_visa_types text[],
  extracted_hourly_rate_min numeric,
  extracted_hourly_rate_max numeric,
  role_title text,
  core_skills text[],
  years_experience numeric,
  visa_types text[],
  work_type text,
  locations text[],
  hourly_rate_min numeric,
  hourly_rate_max numeric,
  relocation_required boolean
)
language sql
security definer
set search_path = public
as $$
  select
    hotlist.id::text,
    matches.profile_id,
    matches.created_at,
    matches.final_average_score::double precision,
    matches.score_breakdown,
    hotlist.platform,
    hotlist.bench_sales_recruiter_name,
    hotlist.bench_sales_recruiter_email,
    hotlist.bench_sales_recruiter_phone,
    hotlist.created_at,
    hotlist.posted_at,
    coalesce(hotlist.posted_at, hotlist.created_at),
    hotlist.role_title,
    hotlist.bench_sales_company_name,
    coalesce(array_to_string(hotlist.locations, ', '), ''),
    hotlist.raw_post_content,
    hotlist.role_title,
    hotlist.employment_type,
    '',
    case
      when hotlist.hourly_rate_min is not null or hotlist.hourly_rate_max is not null
        then concat('$', coalesce(hotlist.hourly_rate_min::text, '?'), '-$', coalesce(hotlist.hourly_rate_max::text, '?'), '/hr')
      else ''
    end,
    hotlist.core_skills,
    hotlist.years_experience::integer,
    case when hotlist.visa_type = '' then '{}'::text[] else array[hotlist.visa_type] end,
    hotlist.hourly_rate_min,
    hotlist.hourly_rate_max,
    matches.role_title,
    matches.core_skills,
    matches.years_experience,
    matches.visa_types,
    matches.work_type,
    matches.locations,
    matches.hourly_rate_min,
    matches.hourly_rate_max,
    null::boolean
  from public.radar_match_hotlist matches
  join public.social_hotlist hotlist on hotlist.id = matches.hotlist_id
  where coalesce(hotlist.posted_at, hotlist.created_at) >= coalesce(p_since, now() - interval '72 hours')
    and (
      p_before_posted_at is null
      or (coalesce(hotlist.posted_at, hotlist.created_at), hotlist.id::text)
        < (p_before_posted_at, coalesce(p_before_lead_id, ''))
    )
  order by coalesce(hotlist.posted_at, hotlist.created_at) desc, hotlist.id::text desc
  limit greatest(1, least(coalesce(p_limit, 1000), 1000));
$$;

revoke all on function public.get_social_hotlist_feed_page(timestamptz, timestamptz, text, integer) from public;
grant execute on function public.get_social_hotlist_feed_page(timestamptz, timestamptz, text, integer)
  to authenticated, service_role;