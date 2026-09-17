-- Hotlist: full-text search it never had, plus the same paged/faceted surface
-- the jobs feed gets in 20260917120100.
--
-- Hotlist search was previously client-side only (the matchesPulseFeedSearch
-- fallback in queryScopedFeed), which worked solely because the client held
-- the entire window. Once the feed pages 100 rows at a time that silently
-- becomes "search the current page", so hotlist needs a real FTS index.

alter table public.social_hotlist
  add column if not exists search_document tsvector;

-- Weighting mirrors social_jobs_search_document_tsvector: the role and skills
-- carry an A, company and location a B, the raw post body a C.
create or replace function public.social_hotlist_search_document_tsvector(
  p_role_title text,
  p_company_name text,
  p_locations text[],
  p_raw_post_content text,
  p_core_skills text[]
)
returns tsvector
language sql
immutable
as $$
  select
    setweight(to_tsvector('english', coalesce(p_role_title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(p_company_name, '')), 'B')
    || setweight(to_tsvector('english', coalesce(array_to_string(p_locations, ' '), '')), 'B')
    || setweight(to_tsvector('english', coalesce(p_raw_post_content, '')), 'C')
    || setweight(to_tsvector('english', coalesce(array_to_string(p_core_skills, ' '), '')), 'A');
$$;

create or replace function public.set_social_hotlist_search_document()
returns trigger
language plpgsql
as $$
begin
  new.search_document := public.social_hotlist_search_document_tsvector(
    new.role_title,
    new.bench_sales_company_name,
    new.locations,
    new.raw_post_content,
    new.core_skills
  );
  return new;
end;
$$;

drop trigger if exists trg_social_hotlist_search_document on public.social_hotlist;

create trigger trg_social_hotlist_search_document
before insert or update of role_title, bench_sales_company_name, locations, raw_post_content, core_skills
on public.social_hotlist
for each row
execute function public.set_social_hotlist_search_document();

update public.social_hotlist
set search_document = public.social_hotlist_search_document_tsvector(
  role_title,
  bench_sales_company_name,
  locations,
  raw_post_content,
  core_skills
)
where search_document is null;

create index if not exists idx_social_hotlist_search_document
  on public.social_hotlist using gin (search_document);

create or replace view public.pulse_feed_hotlist_rows as
  -- Scraped hotlists that have a match.
  select
    hotlist.id::text as lead_id,
    matches.profile_id,
    matches.created_at as match_created_at,
    matches.final_average_score::double precision as final_average_score,
    matches.score_breakdown,
    hotlist.platform,
    hotlist.bench_sales_recruiter_name as posted_by_name,
    hotlist.bench_sales_recruiter_email as poster_email,
    hotlist.bench_sales_recruiter_phone as poster_phone,
    hotlist.created_at as social_created_at,
    hotlist.posted_at,
    coalesce(hotlist.posted_at, hotlist.created_at) as effective_posted_at,
    hotlist.role_title as job_title,
    hotlist.bench_sales_company_name as company_name,
    coalesce(array_to_string(hotlist.locations, ', '), '') as location,
    hotlist.raw_post_content as post_content,
    hotlist.role_title as extracted_role_normalized,
    hotlist.employment_type,
    '' as seniority_level,
    case
      when hotlist.hourly_rate_min is not null or hotlist.hourly_rate_max is not null
        then concat('$', coalesce(hotlist.hourly_rate_min::text, '?'), '-$', coalesce(hotlist.hourly_rate_max::text, '?'), '/hr')
      else ''
    end as salary_range,
    hotlist.core_skills as extracted_skills,
    hotlist.years_experience::integer as extracted_experience_years,
    case when hotlist.visa_type = '' then '{}'::text[] else array[hotlist.visa_type] end as extracted_visa_types,
    hotlist.hourly_rate_min as extracted_hourly_rate_min,
    hotlist.hourly_rate_max as extracted_hourly_rate_max,
    matches.role_title,
    matches.core_skills,
    matches.years_experience,
    matches.visa_types,
    matches.work_type,
    matches.locations,
    matches.hourly_rate_min,
    matches.hourly_rate_max,
    null::boolean as relocation_required,
    hotlist.post_source,
    null::uuid as created_by_account_id,
    null::uuid as created_by_user_id,
    null::text as author_display_name,
    hotlist.bench_sales_recruiter_avatar_url as avatar_url,
    hotlist.search_document
  from public.social_hotlist hotlist
  join lateral (
    select
      m.profile_id,
      m.created_at,
      m.final_average_score,
      m.score_breakdown,
      m.role_title,
      m.core_skills,
      m.years_experience,
      m.visa_types,
      m.work_type,
      m.locations,
      m.hourly_rate_min,
      m.hourly_rate_max
    from public.radar_match_hotlist m
    where m.hotlist_id = hotlist.id
    order by m.created_at desc
    limit 1
  ) matches on true
  where hotlist.hidden_at is null
    and hotlist.post_source = 'linkedin_scrape'

  union all

  -- User posts, no match.
  select
    hotlist.id::text as lead_id,
    null::uuid as profile_id,
    hotlist.created_at as match_created_at,
    null::double precision as final_average_score,
    '{}'::jsonb as score_breakdown,
    hotlist.platform,
    hotlist.bench_sales_recruiter_name as posted_by_name,
    hotlist.bench_sales_recruiter_email as poster_email,
    hotlist.bench_sales_recruiter_phone as poster_phone,
    hotlist.created_at as social_created_at,
    hotlist.posted_at,
    coalesce(hotlist.posted_at, hotlist.created_at) as effective_posted_at,
    hotlist.role_title as job_title,
    hotlist.bench_sales_company_name as company_name,
    coalesce(array_to_string(hotlist.locations, ', '), '') as location,
    hotlist.raw_post_content as post_content,
    hotlist.role_title as extracted_role_normalized,
    hotlist.employment_type,
    '' as seniority_level,
    case
      when hotlist.hourly_rate_min is not null or hotlist.hourly_rate_max is not null
        then concat('$', coalesce(hotlist.hourly_rate_min::text, '?'), '-$', coalesce(hotlist.hourly_rate_max::text, '?'), '/hr')
      else ''
    end as salary_range,
    hotlist.core_skills as extracted_skills,
    hotlist.years_experience::integer as extracted_experience_years,
    case when hotlist.visa_type = '' then '{}'::text[] else array[hotlist.visa_type] end as extracted_visa_types,
    hotlist.hourly_rate_min as extracted_hourly_rate_min,
    hotlist.hourly_rate_max as extracted_hourly_rate_max,
    null::text as role_title,
    null::text[] as core_skills,
    null::numeric as years_experience,
    null::text[] as visa_types,
    null::text as work_type,
    null::text[] as locations,
    null::numeric as hourly_rate_min,
    null::numeric as hourly_rate_max,
    null::boolean as relocation_required,
    hotlist.post_source,
    hotlist.created_by_account_id,
    hotlist.created_by_user_id,
    coalesce(nullif(trim(am.display_name), ''), split_part(am.invited_email, '@', 1), 'ProfilePush user') as author_display_name,
    hotlist.bench_sales_recruiter_avatar_url as avatar_url,
    hotlist.search_document
  from public.social_hotlist hotlist
  left join public.account_members am
    on am.user_id = hotlist.created_by_user_id
   and am.account_id = hotlist.created_by_account_id
  where hotlist.post_source = 'user_post'
    and hotlist.hidden_at is null
    and hotlist.post_status = 'open';

revoke all on public.pulse_feed_hotlist_rows from public, anon, authenticated;

drop function if exists public.get_social_hotlist_feed_page_v2(
  timestamptz, timestamptz, text, integer, text, text[], text[], text[], text[], text[], text, text, numeric, numeric, integer
);

create function public.get_social_hotlist_feed_page_v2(
  p_since timestamptz,
  p_before_posted_at timestamptz default null,
  p_before_lead_id text default null,
  p_limit integer default 100,
  p_query text default null,
  p_experience_ranges text[] default null,
  p_work_types text[] default null,
  p_employment_types text[] default null,
  p_visa_statuses text[] default null,
  p_locations text[] default null,
  p_skills_query text default null,
  p_rate_mode text default null,
  p_rate_min numeric default null,
  p_rate_max numeric default null,
  p_offset integer default 0
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
  relocation_required boolean,
  post_source text,
  created_by_account_id uuid,
  created_by_user_id uuid,
  author_display_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', btrim(p_query)) as tsq
    where nullif(btrim(coalesce(p_query, '')), '') is not null
  ),
  matched as (
    select
      src.*,
      case when q.tsq is null then null else ts_rank_cd(src.search_document, q.tsq) end as search_rank
    from public.pulse_feed_hotlist_rows src
    left join q on true
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (q.tsq is null or src.search_document @@ q.tsq)
      and public.pulse_feed_row_matches_filters(
        src.score_breakdown, src.employment_type, src.extracted_visa_types,
        src.extracted_experience_years, src.seniority_level, src.location,
        src.extracted_skills, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max,
        src.salary_range,
        p_experience_ranges, p_work_types, p_employment_types, p_visa_statuses,
        p_locations, p_skills_query, p_rate_mode, p_rate_min, p_rate_max, null
      )
      and (
        nullif(btrim(coalesce(p_query, '')), '') is not null
        or p_before_posted_at is null
        or (src.effective_posted_at, src.lead_id) < (p_before_posted_at, coalesce(p_before_lead_id, ''))
      )
  )
  select
    lead_id, profile_id, match_created_at, final_average_score, score_breakdown,
    platform, posted_by_name, poster_email, poster_phone, social_created_at,
    posted_at, effective_posted_at, job_title, company_name, location, post_content,
    extracted_role_normalized, employment_type, seniority_level, salary_range,
    extracted_skills, extracted_experience_years, extracted_visa_types,
    extracted_hourly_rate_min, extracted_hourly_rate_max, role_title, core_skills,
    years_experience, visa_types, work_type, locations, hourly_rate_min,
    hourly_rate_max, relocation_required, post_source, created_by_account_id,
    created_by_user_id, author_display_name, avatar_url
  from matched
  order by
    search_rank desc nulls last,
    effective_posted_at desc,
    lead_id desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset case
    when nullif(btrim(coalesce(p_query, '')), '') is null then 0
    else greatest(0, coalesce(p_offset, 0))
  end;
$$;

revoke all on function public.get_social_hotlist_feed_page_v2(
  timestamptz, timestamptz, text, integer, text, text[], text[], text[], text[], text[], text, text, numeric, numeric, integer
) from public;
grant execute on function public.get_social_hotlist_feed_page_v2(
  timestamptz, timestamptz, text, integer, text, text[], text[], text[], text[], text[], text, text, numeric, numeric, integer
) to authenticated, service_role;

drop function if exists public.get_social_hotlist_feed_facets(
  timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
);

create function public.get_social_hotlist_feed_facets(
  p_since timestamptz,
  p_query text default null,
  p_experience_ranges text[] default null,
  p_work_types text[] default null,
  p_employment_types text[] default null,
  p_visa_statuses text[] default null,
  p_locations text[] default null,
  p_skills_query text default null,
  p_rate_mode text default null,
  p_rate_min numeric default null,
  p_rate_max numeric default null
)
returns table (
  facet_category text,
  facet_value text,
  facet_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', btrim(p_query)) as tsq
    where nullif(btrim(coalesce(p_query, '')), '') is not null
  ),
  base as (
    select
      src.score_breakdown, src.employment_type, src.extracted_visa_types,
      src.extracted_experience_years, src.seniority_level, src.location,
      src.extracted_skills, src.extracted_hourly_rate_min,
      src.extracted_hourly_rate_max, src.salary_range
    from public.pulse_feed_hotlist_rows src
    left join q on true
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (q.tsq is null or src.search_document @@ q.tsq)
  ),
  keep as (
    select
      base.*,
      public.pulse_feed_row_matches_filters(
        base.score_breakdown, base.employment_type, base.extracted_visa_types,
        base.extracted_experience_years, base.seniority_level, base.location,
        base.extracted_skills, base.extracted_hourly_rate_min, base.extracted_hourly_rate_max,
        base.salary_range,
        p_experience_ranges, p_work_types, p_employment_types, p_visa_statuses,
        p_locations, p_skills_query, p_rate_mode, p_rate_min, p_rate_max, 'experienceRange'
      ) as keep_experience,
      public.pulse_feed_row_matches_filters(
        base.score_breakdown, base.employment_type, base.extracted_visa_types,
        base.extracted_experience_years, base.seniority_level, base.location,
        base.extracted_skills, base.extracted_hourly_rate_min, base.extracted_hourly_rate_max,
        base.salary_range,
        p_experience_ranges, p_work_types, p_employment_types, p_visa_statuses,
        p_locations, p_skills_query, p_rate_mode, p_rate_min, p_rate_max, 'workType'
      ) as keep_work_type,
      public.pulse_feed_row_matches_filters(
        base.score_breakdown, base.employment_type, base.extracted_visa_types,
        base.extracted_experience_years, base.seniority_level, base.location,
        base.extracted_skills, base.extracted_hourly_rate_min, base.extracted_hourly_rate_max,
        base.salary_range,
        p_experience_ranges, p_work_types, p_employment_types, p_visa_statuses,
        p_locations, p_skills_query, p_rate_mode, p_rate_min, p_rate_max, 'employmentType'
      ) as keep_employment_type,
      public.pulse_feed_row_matches_filters(
        base.score_breakdown, base.employment_type, base.extracted_visa_types,
        base.extracted_experience_years, base.seniority_level, base.location,
        base.extracted_skills, base.extracted_hourly_rate_min, base.extracted_hourly_rate_max,
        base.salary_range,
        p_experience_ranges, p_work_types, p_employment_types, p_visa_statuses,
        p_locations, p_skills_query, p_rate_mode, p_rate_min, p_rate_max, 'visaStatus'
      ) as keep_visa_status
    from base
  )
  select 'experienceRange'::text, range_id::text, count(*)
  from keep
  cross join unnest(array['1-3', '3-5', '5-7', '7-9', '9-12', '12-15', '15+']) as range_id
  where keep.keep_experience
    and public.pulse_experience_range_matches(
      public.pulse_facet_experience_years(keep.score_breakdown, keep.extracted_experience_years, keep.seniority_level),
      range_id
    )
  group by range_id

  union all
  select 'workType'::text, public.pulse_facet_work_type(keep.score_breakdown), count(*)
  from keep
  where keep.keep_work_type
  group by 2

  union all
  select 'employmentType'::text, public.pulse_facet_employment_type(keep.score_breakdown, keep.employment_type), count(*)
  from keep
  where keep.keep_employment_type
  group by 2

  union all
  select 'visaStatus'::text, public.pulse_facet_visa_status(keep.score_breakdown, keep.extracted_visa_types), count(*)
  from keep
  where keep.keep_visa_status
  group by 2

  union all
  select 'total'::text, 'all'::text, count(*)
  from keep
  where public.pulse_feed_row_matches_filters(
    keep.score_breakdown, keep.employment_type, keep.extracted_visa_types,
    keep.extracted_experience_years, keep.seniority_level, keep.location,
    keep.extracted_skills, keep.extracted_hourly_rate_min, keep.extracted_hourly_rate_max,
    keep.salary_range,
    p_experience_ranges, p_work_types, p_employment_types, p_visa_statuses,
    p_locations, p_skills_query, p_rate_mode, p_rate_min, p_rate_max, null
  );
$$;

revoke all on function public.get_social_hotlist_feed_facets(
  timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
) from public;
grant execute on function public.get_social_hotlist_feed_facets(
  timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
) to authenticated, service_role;
