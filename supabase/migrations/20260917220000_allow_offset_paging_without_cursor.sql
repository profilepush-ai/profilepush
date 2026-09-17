-- Allow offset paging when there is no keyset cursor.
--
-- Keyset paging is forward-only from a known row, so a refreshed or shared
-- ?page=3 had no way to reach page three directly. The offset was previously
-- honoured only while searching; it now applies whenever p_before_posted_at is
-- null, so a cold load can jump to a page and Next/Previous can carry on by
-- cursor from there.

create or replace function public.get_pulse_social_feed_page_v2(
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
  with   eligible as (
    select
      src.*,
      case
        when nullif(btrim(coalesce(p_query, '')), '') is null then null
        else ts_rank_cd(src.search_document, websearch_to_tsquery('english', btrim(p_query)))
      end as search_rank
    from public.pulse_feed_jobs_rows_keyed src
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (
        nullif(btrim(coalesce(p_query, '')), '') is null
        or src.search_document @@ websearch_to_tsquery('english', btrim(p_query))
      )
      and (
        coalesce(array_length(p_experience_ranges, 1), 0) = 0
        or exists (
          select 1 from unnest(p_experience_ranges) as range_id
          where public.pulse_experience_range_matches(
            public.pulse_facet_experience_years(src.score_breakdown, src.extracted_experience_years, src.seniority_level),
            range_id
          )
        )
      )
      and (
        coalesce(array_length(p_work_types, 1), 0) = 0
        or public.pulse_facet_work_type(src.score_breakdown) = any(p_work_types)
      )
      and (
        coalesce(array_length(p_employment_types, 1), 0) = 0
        or public.pulse_facet_employment_type(src.score_breakdown, src.employment_type) = any(p_employment_types)
      )
      and (
        coalesce(array_length(p_visa_statuses, 1), 0) = 0
        or public.pulse_facet_visa_status(src.score_breakdown, src.extracted_visa_types) = any(p_visa_statuses)
      )
      and (
        coalesce(array_length(p_locations, 1), 0) = 0
        or exists (
          select 1 from unnest(p_locations) as loc
          where public.pulse_facet_location(src.score_breakdown, src.location) like '%' || public.pulse_normalize(loc) || '%'
        )
      )
      and (
        nullif(btrim(coalesce(p_skills_query, '')), '') is null
        or public.pulse_facet_skills(src.score_breakdown, src.extracted_skills) like '%' || public.pulse_normalize(p_skills_query) || '%'
      )
      and (
        p_rate_mode is distinct from 'has_rate'
        or public.pulse_facet_has_rate(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range)
      )
      and (
        p_rate_mode is distinct from 'range'
        or (
          public.pulse_facet_rate_value(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) is not null
          and (p_rate_min is null or public.pulse_facet_rate_value(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) >= p_rate_min)
          and (p_rate_max is null or public.pulse_facet_rate_value(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) <= p_rate_max)
        )
      )
  ),
  deduped as (
    select
      eligible.*,
      row_number() over (
        partition by eligible.dedup_key
        order by eligible.effective_posted_at desc, eligible.lead_id desc
      ) as dedup_rank
    from eligible
  ),
  matched as (
    select *
    from deduped
    where dedup_rank = 1
      and (
        nullif(btrim(coalesce(p_query, '')), '') is not null
        or p_before_posted_at is null
        or (effective_posted_at, lead_id) < (p_before_posted_at, coalesce(p_before_lead_id, ''))
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
  -- Offset applies whenever no keyset cursor was supplied. Next/Previous still
  -- page by cursor, which stays cheap; the offset path exists so a bookmarked
  -- or refreshed ?page=3 can land directly on page three without walking the
  -- cursor chain from the start.
  offset case
    when p_before_posted_at is not null then 0
    else greatest(0, coalesce(p_offset, 0))
  end;
$$;

create or replace function public.get_social_hotlist_feed_page_v2(
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
  with   eligible as (
    select
      src.*,
      case
        when nullif(btrim(coalesce(p_query, '')), '') is null then null
        else ts_rank_cd(src.search_document, websearch_to_tsquery('english', btrim(p_query)))
      end as search_rank
    from public.pulse_feed_hotlist_rows_keyed src
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (
        nullif(btrim(coalesce(p_query, '')), '') is null
        or src.search_document @@ websearch_to_tsquery('english', btrim(p_query))
      )
      and (
        coalesce(array_length(p_experience_ranges, 1), 0) = 0
        or exists (
          select 1 from unnest(p_experience_ranges) as range_id
          where public.pulse_experience_range_matches(
            public.pulse_facet_experience_years(src.score_breakdown, src.extracted_experience_years, src.seniority_level),
            range_id
          )
        )
      )
      and (
        coalesce(array_length(p_work_types, 1), 0) = 0
        or public.pulse_facet_work_type(src.score_breakdown) = any(p_work_types)
      )
      and (
        coalesce(array_length(p_employment_types, 1), 0) = 0
        or public.pulse_facet_employment_type(src.score_breakdown, src.employment_type) = any(p_employment_types)
      )
      and (
        coalesce(array_length(p_visa_statuses, 1), 0) = 0
        or public.pulse_facet_visa_status(src.score_breakdown, src.extracted_visa_types) = any(p_visa_statuses)
      )
      and (
        coalesce(array_length(p_locations, 1), 0) = 0
        or exists (
          select 1 from unnest(p_locations) as loc
          where public.pulse_facet_location(src.score_breakdown, src.location) like '%' || public.pulse_normalize(loc) || '%'
        )
      )
      and (
        nullif(btrim(coalesce(p_skills_query, '')), '') is null
        or public.pulse_facet_skills(src.score_breakdown, src.extracted_skills) like '%' || public.pulse_normalize(p_skills_query) || '%'
      )
      and (
        p_rate_mode is distinct from 'has_rate'
        or public.pulse_facet_has_rate(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range)
      )
      and (
        p_rate_mode is distinct from 'range'
        or (
          public.pulse_facet_rate_value(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) is not null
          and (p_rate_min is null or public.pulse_facet_rate_value(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) >= p_rate_min)
          and (p_rate_max is null or public.pulse_facet_rate_value(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) <= p_rate_max)
        )
      )
  ),
  deduped as (
    select
      eligible.*,
      row_number() over (
        partition by eligible.dedup_key
        order by eligible.effective_posted_at desc, eligible.lead_id desc
      ) as dedup_rank
    from eligible
  ),
  matched as (
    select *
    from deduped
    where dedup_rank = 1
      and (
        nullif(btrim(coalesce(p_query, '')), '') is not null
        or p_before_posted_at is null
        or (effective_posted_at, lead_id) < (p_before_posted_at, coalesce(p_before_lead_id, ''))
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
  -- Offset applies whenever no keyset cursor was supplied. Next/Previous still
  -- page by cursor, which stays cheap; the offset path exists so a bookmarked
  -- or refreshed ?page=3 can land directly on page three without walking the
  -- cursor chain from the start.
  offset case
    when p_before_posted_at is not null then 0
    else greatest(0, coalesce(p_offset, 0))
  end;
$$;

