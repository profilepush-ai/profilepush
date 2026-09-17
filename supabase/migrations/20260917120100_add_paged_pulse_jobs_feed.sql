-- Server-side paging, search and facet counts for the jobs feed.
--
-- The existing get_pulse_social_feed_page stays untouched so the currently
-- deployed client keeps working; this adds the _v2 surface the paged client
-- moves to, and the old one can be dropped once that ships.
--
-- Two problems are fixed along the way:
--
-- 1. The old RPC's latest_matches CTE ran DISTINCT ON over *every* social row
--    in radar_match_results and only applied p_since afterwards, at the join.
--    Postgres can't push the date predicate through the DISTINCT ON, so query
--    cost tracked total table size rather than the requested window — the
--    reason 48h was already slow. Here social_jobs is filtered first and the
--    latest match is fetched per surviving row with a LATERAL, so cost tracks
--    the window.
--
-- 2. The old join was `social.id::text = latest.lead_id`, casting a uuid PK to
--    text and giving up the index. The lateral compares uuid to uuid.
--
-- Browse, search and counts all read one view, so a row can never be filtered
-- one way for the list and another way for the number beside the filter.

create or replace view public.pulse_feed_jobs_rows as
  -- Scraped posts: only those with a radar match, matching the old inner join.
  select
    social.id::text as lead_id,
    latest.profile_id,
    latest.match_created_at,
    latest.final_average_score,
    latest.score_breakdown,
    social.platform,
    social.posted_by_name,
    social.poster_email,
    social.poster_phone,
    social.created_at as social_created_at,
    social.posted_at,
    coalesce(social.posted_at, social.created_at) as effective_posted_at,
    social.job_title,
    social.company_name,
    social.location,
    social.post_content,
    social.extracted_role_normalized,
    social.employment_type,
    social.seniority_level,
    social.salary_range,
    case
      when social.extracted_skills is null then null
      when jsonb_typeof(social.extracted_skills) = 'array' then array(select jsonb_array_elements_text(social.extracted_skills))
      else null
    end as extracted_skills,
    social.extracted_experience_years,
    case
      when social.extracted_visa_types is null then null
      when jsonb_typeof(social.extracted_visa_types) = 'array' then array(select jsonb_array_elements_text(social.extracted_visa_types))
      else null
    end as extracted_visa_types,
    social.extracted_hourly_rate_min,
    social.extracted_hourly_rate_max,
    latest.role_title,
    latest.core_skills,
    latest.years_experience,
    latest.visa_types,
    latest.work_type,
    latest.locations,
    latest.hourly_rate_min,
    latest.hourly_rate_max,
    latest.relocation_required,
    social.post_source,
    null::uuid as created_by_account_id,
    null::uuid as created_by_user_id,
    null::text as author_display_name,
    social.avatar_url,
    social.search_document
  from public.social_jobs social
  join lateral (
    select
      r.profile_id,
      r.created_at as match_created_at,
      r.final_average_score,
      r.score_breakdown,
      r.role_title,
      r.core_skills,
      r.years_experience,
      r.visa_types,
      r.work_type,
      r.locations,
      r.hourly_rate_min,
      r.hourly_rate_max,
      r.relocation_required
    from public.radar_match_results r
    where r.job_source = 'social'
      and r.job_id = social.id
    order by r.created_at desc
    limit 1
  ) latest on true
  where social.hidden_at is null
    and social.post_source = 'linkedin_scrape'

  union all

  -- User posts carry no match, exactly as before.
  select
    social.id::text as lead_id,
    null::uuid as profile_id,
    social.created_at as match_created_at,
    null::double precision as final_average_score,
    '{}'::jsonb as score_breakdown,
    social.platform,
    social.posted_by_name,
    social.poster_email,
    social.poster_phone,
    social.created_at as social_created_at,
    social.posted_at,
    coalesce(social.posted_at, social.created_at) as effective_posted_at,
    social.job_title,
    social.company_name,
    social.location,
    social.post_content,
    social.extracted_role_normalized,
    social.employment_type,
    social.seniority_level,
    social.salary_range,
    case
      when social.extracted_skills is null then null
      when jsonb_typeof(social.extracted_skills) = 'array' then array(select jsonb_array_elements_text(social.extracted_skills))
      else null
    end as extracted_skills,
    social.extracted_experience_years,
    case
      when social.extracted_visa_types is null then null
      when jsonb_typeof(social.extracted_visa_types) = 'array' then array(select jsonb_array_elements_text(social.extracted_visa_types))
      else null
    end as extracted_visa_types,
    social.extracted_hourly_rate_min,
    social.extracted_hourly_rate_max,
    null::text as role_title,
    null::text[] as core_skills,
    null::numeric as years_experience,
    null::text[] as visa_types,
    null::text as work_type,
    null::text[] as locations,
    null::numeric as hourly_rate_min,
    null::numeric as hourly_rate_max,
    null::boolean as relocation_required,
    social.post_source,
    social.created_by_account_id,
    social.created_by_user_id,
    coalesce(nullif(trim(am.display_name), ''), split_part(am.invited_email, '@', 1), 'ProfilePush user') as author_display_name,
    social.avatar_url,
    social.search_document
  from public.social_jobs social
  left join public.account_members am
    on am.user_id = social.created_by_user_id
   and am.account_id = social.created_by_account_id
  where social.post_source = 'user_post'
    and social.hidden_at is null
    and social.post_status = 'open';

-- The view is a helper for the SECURITY DEFINER functions below and is not
-- addressable by clients; leaving it ungranted keeps social_jobs' RLS from
-- being sidestepped by selecting the view directly.
revoke all on public.pulse_feed_jobs_rows from public, anon, authenticated;

-- Shared filter predicate. Null/empty means "no filter for this category",
-- mirroring matchesLeadFilters, where an empty selection array short-circuits.
-- p_skip_category lets the facet counter exclude the category it is counting,
-- which is how picking an option never shrinks its own option's count.
create or replace function public.pulse_feed_row_matches_filters(
  p_score_breakdown jsonb,
  p_employment_type text,
  p_visa_types text[],
  p_extracted_experience_years integer,
  p_seniority_level text,
  p_location text,
  p_extracted_skills text[],
  p_hourly_rate_min numeric,
  p_hourly_rate_max numeric,
  p_salary_range text,
  p_experience_ranges text[],
  p_work_types text[],
  p_employment_types text[],
  p_visa_statuses text[],
  p_locations text[],
  p_skills_query text,
  p_rate_mode text,
  p_rate_min numeric,
  p_rate_max numeric,
  p_skip_category text default null
)
returns boolean
language sql
stable
parallel safe
as $$
  select
    -- experienceRange: OR across the selected ranges.
    (
      p_skip_category is not distinct from 'experienceRange'
      or coalesce(array_length(p_experience_ranges, 1), 0) = 0
      or exists (
        select 1
        from unnest(p_experience_ranges) as range_id
        where public.pulse_experience_range_matches(
          public.pulse_facet_experience_years(p_score_breakdown, p_extracted_experience_years, p_seniority_level),
          range_id
        )
      )
    )
    and (
      p_skip_category is not distinct from 'workType'
      or coalesce(array_length(p_work_types, 1), 0) = 0
      or public.pulse_facet_work_type(p_score_breakdown) = any(p_work_types)
    )
    and (
      p_skip_category is not distinct from 'employmentType'
      or coalesce(array_length(p_employment_types, 1), 0) = 0
      or public.pulse_facet_employment_type(p_score_breakdown, p_employment_type) = any(p_employment_types)
    )
    and (
      p_skip_category is not distinct from 'visaStatus'
      or coalesce(array_length(p_visa_statuses, 1), 0) = 0
      or public.pulse_facet_visa_status(p_score_breakdown, p_visa_types) = any(p_visa_statuses)
    )
    -- location and the remaining filters are never excluded: matchesLeadFilters
    -- applies them regardless of excludeCategory.
    and (
      coalesce(array_length(p_locations, 1), 0) = 0
      or exists (
        select 1
        from unnest(p_locations) as loc
        where public.pulse_facet_location(p_score_breakdown, p_location) like '%' || public.pulse_normalize(loc) || '%'
      )
    )
    and (
      nullif(btrim(coalesce(p_skills_query, '')), '') is null
      or public.pulse_facet_skills(p_score_breakdown, p_extracted_skills) like '%' || public.pulse_normalize(p_skills_query) || '%'
    )
    and (
      p_rate_mode is distinct from 'has_rate'
      or public.pulse_facet_has_rate(p_score_breakdown, p_hourly_rate_min, p_hourly_rate_max, p_salary_range)
    )
    and (
      p_rate_mode is distinct from 'range'
      or (
        public.pulse_facet_rate_value(p_score_breakdown, p_hourly_rate_min, p_hourly_rate_max, p_salary_range) is not null
        and (p_rate_min is null or public.pulse_facet_rate_value(p_score_breakdown, p_hourly_rate_min, p_hourly_rate_max, p_salary_range) >= p_rate_min)
        and (p_rate_max is null or public.pulse_facet_rate_value(p_score_breakdown, p_hourly_rate_min, p_hourly_rate_max, p_salary_range) <= p_rate_max)
      )
    );
$$;

drop function if exists public.get_pulse_social_feed_page_v2(
  timestamptz, timestamptz, text, integer, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
);

-- Browse page: keyset on (effective_posted_at, lead_id), matching the index
-- added in the helpers migration. p_query, when present, switches the ordering
-- to FTS rank and pages by offset instead — rank isn't keyset-able, and a
-- search result set is small enough that offset paging is fine.
create function public.get_pulse_social_feed_page_v2(
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
    from public.pulse_feed_jobs_rows src
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

revoke all on function public.get_pulse_social_feed_page_v2(
  timestamptz, timestamptz, text, integer, text, text[], text[], text[], text[], text[], text, text, numeric, numeric, integer
) from public;
grant execute on function public.get_pulse_social_feed_page_v2(
  timestamptz, timestamptz, text, integer, text, text[], text[], text[], text[], text[], text, text, numeric, numeric, integer
) to authenticated, service_role;

drop function if exists public.get_pulse_social_feed_facets(
  timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
);

-- Facet counts over the whole window, one row per (category, value). Each
-- category is counted with its own selection excluded, which is what
-- feedFacetCounts does client-side via matchesLeadFilters(lead, category).
create function public.get_pulse_social_feed_facets(
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
    from public.pulse_feed_jobs_rows src
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

  -- Total row count for the current filter set, so the client can show
  -- "N results" and know when to stop paging.
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

revoke all on function public.get_pulse_social_feed_facets(
  timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
) from public;
grant execute on function public.get_pulse_social_feed_facets(
  timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
) to authenticated, service_role;
