/*
# Feed search: plan with the real search text

These Feed functions were plain SQL functions, planned once with generic
parameters. With "search_document @@ query OR query is null" the planner could
not tell a search was happening, so it skipped the search index and walked the
whole 30-day Feed view: about 18s, past the 8s statement timeout, and the Feed
came back blank for any search.

Same queries, now plpgsql planned per call (force_custom_plan), so the search
text and filters are known and the indexes are used.
*/

CREATE OR REPLACE FUNCTION public.get_pulse_social_feed_page_v2(p_since timestamp with time zone, p_before_posted_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_lead_id text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_query text DEFAULT NULL::text, p_experience_ranges text[] DEFAULT NULL::text[], p_work_types text[] DEFAULT NULL::text[], p_employment_types text[] DEFAULT NULL::text[], p_visa_statuses text[] DEFAULT NULL::text[], p_locations text[] DEFAULT NULL::text[], p_skills_query text DEFAULT NULL::text, p_rate_mode text DEFAULT NULL::text, p_rate_min numeric DEFAULT NULL::numeric, p_rate_max numeric DEFAULT NULL::numeric, p_offset integer DEFAULT 0)
 RETURNS TABLE(lead_id text, profile_id uuid, match_created_at timestamp with time zone, final_average_score double precision, score_breakdown jsonb, platform text, posted_by_name text, poster_email text, poster_phone text, social_created_at timestamp with time zone, posted_at timestamp with time zone, effective_posted_at timestamp with time zone, job_title text, company_name text, location text, post_content text, extracted_role_normalized text, employment_type text, seniority_level text, salary_range text, extracted_skills text[], extracted_experience_years integer, extracted_visa_types text[], extracted_hourly_rate_min numeric, extracted_hourly_rate_max numeric, role_title text, core_skills text[], years_experience numeric, visa_types text[], work_type text, locations text[], hourly_rate_min numeric, hourly_rate_max numeric, relocation_required boolean, post_source text, created_by_account_id uuid, created_by_user_id uuid, author_display_name text, avatar_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
begin
  return query
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
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_pulse_social_feed_facets_live(p_since timestamp with time zone, p_query text DEFAULT NULL::text, p_experience_ranges text[] DEFAULT NULL::text[], p_work_types text[] DEFAULT NULL::text[], p_employment_types text[] DEFAULT NULL::text[], p_visa_statuses text[] DEFAULT NULL::text[], p_locations text[] DEFAULT NULL::text[], p_skills_query text DEFAULT NULL::text, p_rate_mode text DEFAULT NULL::text, p_rate_min numeric DEFAULT NULL::numeric, p_rate_max numeric DEFAULT NULL::numeric)
 RETURNS TABLE(facet_category text, facet_value text, facet_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
begin
  return query
with   windowed as (
    select
      src.dedup_key,
      src.effective_posted_at,
      src.lead_id,
      -- The four counted categories are always needed.
      public.pulse_facet_work_type(src.score_breakdown) as f_work_type,
      public.pulse_facet_employment_type(src.score_breakdown, src.employment_type) as f_employment_type,
      public.pulse_facet_visa_status(src.score_breakdown, src.extracted_visa_types) as f_visa_status,
      public.pulse_facet_experience_years(src.score_breakdown, src.extracted_experience_years, src.seniority_level) as f_experience_years,
      -- These three only narrow the set and are never counted, so they are
      -- computed only when their filter is actually set. The parameters are
      -- constants for the query, so the planner folds the untaken branch away
      -- and the helper never runs -- which is the common, unfiltered case.
      case when coalesce(array_length(p_locations, 1), 0) = 0 then null
           else public.pulse_facet_location(src.score_breakdown, src.location) end as f_location,
      case when nullif(btrim(coalesce(p_skills_query, '')), '') is null then null
           else public.pulse_facet_skills(src.score_breakdown, src.extracted_skills) end as f_skills,
      case when p_rate_mode is null then null
           else public.pulse_facet_rate_text(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) end as f_rate_text
    from public.pulse_feed_jobs_rows_keyed src
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (
        nullif(btrim(coalesce(p_query, '')), '') is null
        or src.search_document @@ websearch_to_tsquery('english', btrim(p_query))
      )
  ),
  -- MATERIALIZED so the derived values are computed once rather than once per
  -- referencing branch below. Only the narrow derived columns are carried.
  vals as materialized (
    select *
    from (
      select
        windowed.*,
        row_number() over (
          partition by windowed.dedup_key
          order by windowed.effective_posted_at desc, windowed.lead_id desc
        ) as dedup_rank
      from windowed
    ) ranked
    where dedup_rank = 1
  ),
  keep as (
    select
      vals.*,
      (coalesce(array_length(p_locations, 1), 0) = 0
        or exists (select 1 from unnest(p_locations) as loc where vals.f_location like '%' || public.pulse_normalize(loc) || '%'))
      and (nullif(btrim(coalesce(p_skills_query, '')), '') is null
        or vals.f_skills like '%' || public.pulse_normalize(p_skills_query) || '%')
      and (p_rate_mode is distinct from 'has_rate'
        or (vals.f_rate_text <> '-' and public.pulse_normalize(vals.f_rate_text) <> 'unknown'))
      and (p_rate_mode is distinct from 'range' or (
        public.pulse_parse_first_numeric(vals.f_rate_text) is not null
        and (p_rate_min is null or public.pulse_parse_first_numeric(vals.f_rate_text) >= p_rate_min)
        and (p_rate_max is null or public.pulse_parse_first_numeric(vals.f_rate_text) <= p_rate_max)
      )) as keep_always,
      (coalesce(array_length(p_experience_ranges, 1), 0) = 0
        or exists (select 1 from unnest(p_experience_ranges) as r where public.pulse_experience_range_matches(vals.f_experience_years, r))) as keep_experience,
      (coalesce(array_length(p_work_types, 1), 0) = 0 or vals.f_work_type = any(p_work_types)) as keep_work_type,
      (coalesce(array_length(p_employment_types, 1), 0) = 0 or vals.f_employment_type = any(p_employment_types)) as keep_employment_type,
      (coalesce(array_length(p_visa_statuses, 1), 0) = 0 or vals.f_visa_status = any(p_visa_statuses)) as keep_visa_status
    from vals
  )
  select 'experienceRange'::text, range_id::text, count(*)
  from keep
  cross join unnest(array['1-3', '3-5', '5-7', '7-9', '9-12', '12-15', '15+']) as range_id
  where keep.keep_always and keep.keep_work_type and keep.keep_employment_type and keep.keep_visa_status
    and public.pulse_experience_range_matches(keep.f_experience_years, range_id)
  group by range_id

  union all
  select 'workType'::text, keep.f_work_type, count(*)
  from keep
  where keep.keep_always and keep.keep_experience and keep.keep_employment_type and keep.keep_visa_status
  group by 2

  union all
  select 'employmentType'::text, keep.f_employment_type, count(*)
  from keep
  where keep.keep_always and keep.keep_experience and keep.keep_work_type and keep.keep_visa_status
  group by 2

  union all
  select 'visaStatus'::text, keep.f_visa_status, count(*)
  from keep
  where keep.keep_always and keep.keep_experience and keep.keep_work_type and keep.keep_employment_type
  group by 2

  union all
  select 'total'::text, 'all'::text, count(*)
  from keep
  where keep.keep_always and keep.keep_experience and keep.keep_work_type
    and keep.keep_employment_type and keep.keep_visa_status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_social_hotlist_feed_page_v2(p_since timestamp with time zone, p_before_posted_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_lead_id text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_query text DEFAULT NULL::text, p_experience_ranges text[] DEFAULT NULL::text[], p_work_types text[] DEFAULT NULL::text[], p_employment_types text[] DEFAULT NULL::text[], p_visa_statuses text[] DEFAULT NULL::text[], p_locations text[] DEFAULT NULL::text[], p_skills_query text DEFAULT NULL::text, p_rate_mode text DEFAULT NULL::text, p_rate_min numeric DEFAULT NULL::numeric, p_rate_max numeric DEFAULT NULL::numeric, p_offset integer DEFAULT 0)
 RETURNS TABLE(lead_id text, profile_id uuid, match_created_at timestamp with time zone, final_average_score double precision, score_breakdown jsonb, platform text, posted_by_name text, poster_email text, poster_phone text, social_created_at timestamp with time zone, posted_at timestamp with time zone, effective_posted_at timestamp with time zone, job_title text, company_name text, location text, post_content text, extracted_role_normalized text, employment_type text, seniority_level text, salary_range text, extracted_skills text[], extracted_experience_years integer, extracted_visa_types text[], extracted_hourly_rate_min numeric, extracted_hourly_rate_max numeric, role_title text, core_skills text[], years_experience numeric, visa_types text[], work_type text, locations text[], hourly_rate_min numeric, hourly_rate_max numeric, relocation_required boolean, post_source text, created_by_account_id uuid, created_by_user_id uuid, author_display_name text, avatar_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
begin
  return query
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
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_social_hotlist_feed_facets(p_since timestamp with time zone, p_query text DEFAULT NULL::text, p_experience_ranges text[] DEFAULT NULL::text[], p_work_types text[] DEFAULT NULL::text[], p_employment_types text[] DEFAULT NULL::text[], p_visa_statuses text[] DEFAULT NULL::text[], p_locations text[] DEFAULT NULL::text[], p_skills_query text DEFAULT NULL::text, p_rate_mode text DEFAULT NULL::text, p_rate_min numeric DEFAULT NULL::numeric, p_rate_max numeric DEFAULT NULL::numeric)
 RETURNS TABLE(facet_category text, facet_value text, facet_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
begin
  return query
with   windowed as (
    select
      src.dedup_key,
      src.effective_posted_at,
      src.lead_id,
      -- The four counted categories are always needed.
      public.pulse_facet_work_type(src.score_breakdown) as f_work_type,
      public.pulse_facet_employment_type(src.score_breakdown, src.employment_type) as f_employment_type,
      public.pulse_facet_visa_status(src.score_breakdown, src.extracted_visa_types) as f_visa_status,
      public.pulse_facet_experience_years(src.score_breakdown, src.extracted_experience_years, src.seniority_level) as f_experience_years,
      -- These three only narrow the set and are never counted, so they are
      -- computed only when their filter is actually set. The parameters are
      -- constants for the query, so the planner folds the untaken branch away
      -- and the helper never runs -- which is the common, unfiltered case.
      case when coalesce(array_length(p_locations, 1), 0) = 0 then null
           else public.pulse_facet_location(src.score_breakdown, src.location) end as f_location,
      case when nullif(btrim(coalesce(p_skills_query, '')), '') is null then null
           else public.pulse_facet_skills(src.score_breakdown, src.extracted_skills) end as f_skills,
      case when p_rate_mode is null then null
           else public.pulse_facet_rate_text(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) end as f_rate_text
    from public.pulse_feed_hotlist_rows_keyed src
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (
        nullif(btrim(coalesce(p_query, '')), '') is null
        or src.search_document @@ websearch_to_tsquery('english', btrim(p_query))
      )
  ),
  -- MATERIALIZED so the derived values are computed once rather than once per
  -- referencing branch below. Only the narrow derived columns are carried.
  vals as materialized (
    select *
    from (
      select
        windowed.*,
        row_number() over (
          partition by windowed.dedup_key
          order by windowed.effective_posted_at desc, windowed.lead_id desc
        ) as dedup_rank
      from windowed
    ) ranked
    where dedup_rank = 1
  ),
  keep as (
    select
      vals.*,
      (coalesce(array_length(p_locations, 1), 0) = 0
        or exists (select 1 from unnest(p_locations) as loc where vals.f_location like '%' || public.pulse_normalize(loc) || '%'))
      and (nullif(btrim(coalesce(p_skills_query, '')), '') is null
        or vals.f_skills like '%' || public.pulse_normalize(p_skills_query) || '%')
      and (p_rate_mode is distinct from 'has_rate'
        or (vals.f_rate_text <> '-' and public.pulse_normalize(vals.f_rate_text) <> 'unknown'))
      and (p_rate_mode is distinct from 'range' or (
        public.pulse_parse_first_numeric(vals.f_rate_text) is not null
        and (p_rate_min is null or public.pulse_parse_first_numeric(vals.f_rate_text) >= p_rate_min)
        and (p_rate_max is null or public.pulse_parse_first_numeric(vals.f_rate_text) <= p_rate_max)
      )) as keep_always,
      (coalesce(array_length(p_experience_ranges, 1), 0) = 0
        or exists (select 1 from unnest(p_experience_ranges) as r where public.pulse_experience_range_matches(vals.f_experience_years, r))) as keep_experience,
      (coalesce(array_length(p_work_types, 1), 0) = 0 or vals.f_work_type = any(p_work_types)) as keep_work_type,
      (coalesce(array_length(p_employment_types, 1), 0) = 0 or vals.f_employment_type = any(p_employment_types)) as keep_employment_type,
      (coalesce(array_length(p_visa_statuses, 1), 0) = 0 or vals.f_visa_status = any(p_visa_statuses)) as keep_visa_status
    from vals
  )
  select 'experienceRange'::text, range_id::text, count(*)
  from keep
  cross join unnest(array['1-3', '3-5', '5-7', '7-9', '9-12', '12-15', '15+']) as range_id
  where keep.keep_always and keep.keep_work_type and keep.keep_employment_type and keep.keep_visa_status
    and public.pulse_experience_range_matches(keep.f_experience_years, range_id)
  group by range_id

  union all
  select 'workType'::text, keep.f_work_type, count(*)
  from keep
  where keep.keep_always and keep.keep_experience and keep.keep_employment_type and keep.keep_visa_status
  group by 2

  union all
  select 'employmentType'::text, keep.f_employment_type, count(*)
  from keep
  where keep.keep_always and keep.keep_experience and keep.keep_work_type and keep.keep_visa_status
  group by 2

  union all
  select 'visaStatus'::text, keep.f_visa_status, count(*)
  from keep
  where keep.keep_always and keep.keep_experience and keep.keep_work_type and keep.keep_employment_type
  group by 2

  union all
  select 'total'::text, 'all'::text, count(*)
  from keep
  where keep.keep_always and keep.keep_experience and keep.keep_work_type
    and keep.keep_employment_type and keep.keep_visa_status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_subscribed_jobs_feed_page(p_since timestamp with time zone, p_before_posted_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_lead_id text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_query text DEFAULT NULL::text, p_experience_ranges text[] DEFAULT NULL::text[], p_work_types text[] DEFAULT NULL::text[], p_employment_types text[] DEFAULT NULL::text[], p_visa_statuses text[] DEFAULT NULL::text[], p_locations text[] DEFAULT NULL::text[], p_skills_query text DEFAULT NULL::text, p_rate_mode text DEFAULT NULL::text, p_rate_min numeric DEFAULT NULL::numeric, p_rate_max numeric DEFAULT NULL::numeric, p_offset integer DEFAULT 0)
 RETURNS TABLE(lead_id text, profile_id uuid, match_created_at timestamp with time zone, final_average_score double precision, score_breakdown jsonb, platform text, posted_by_name text, poster_email text, poster_phone text, social_created_at timestamp with time zone, posted_at timestamp with time zone, effective_posted_at timestamp with time zone, job_title text, company_name text, location text, post_content text, extracted_role_normalized text, employment_type text, seniority_level text, salary_range text, extracted_skills text[], extracted_experience_years integer, extracted_visa_types text[], extracted_hourly_rate_min numeric, extracted_hourly_rate_max numeric, role_title text, core_skills text[], years_experience numeric, visa_types text[], work_type text, locations text[], hourly_rate_min numeric, hourly_rate_max numeric, relocation_required boolean, post_source text, created_by_account_id uuid, created_by_user_id uuid, author_display_name text, avatar_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
begin
  return query
with   eligible as (
    select
      src.*,
      case
        when nullif(btrim(coalesce(p_query, '')), '') is null then null
        else ts_rank_cd(src.search_document, websearch_to_tsquery('english', btrim(p_query)))
      end as search_rank
    from public.pulse_feed_jobs_rows_keyed src
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      -- Only posters the viewer subscribes to.
      and public.publisher_email_key(src.poster_email) in (
        select p.email
        from public.publisher_follows f
        join public.publisher_profiles p on p.id = f.publisher_id
        where f.account_id = public.publisher_account_for_user(auth.uid())
      )
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
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_subscribed_hotlist_feed_page(p_since timestamp with time zone, p_before_posted_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_lead_id text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_query text DEFAULT NULL::text, p_experience_ranges text[] DEFAULT NULL::text[], p_work_types text[] DEFAULT NULL::text[], p_employment_types text[] DEFAULT NULL::text[], p_visa_statuses text[] DEFAULT NULL::text[], p_locations text[] DEFAULT NULL::text[], p_skills_query text DEFAULT NULL::text, p_rate_mode text DEFAULT NULL::text, p_rate_min numeric DEFAULT NULL::numeric, p_rate_max numeric DEFAULT NULL::numeric, p_offset integer DEFAULT 0)
 RETURNS TABLE(lead_id text, profile_id uuid, match_created_at timestamp with time zone, final_average_score double precision, score_breakdown jsonb, platform text, posted_by_name text, poster_email text, poster_phone text, social_created_at timestamp with time zone, posted_at timestamp with time zone, effective_posted_at timestamp with time zone, job_title text, company_name text, location text, post_content text, extracted_role_normalized text, employment_type text, seniority_level text, salary_range text, extracted_skills text[], extracted_experience_years integer, extracted_visa_types text[], extracted_hourly_rate_min numeric, extracted_hourly_rate_max numeric, role_title text, core_skills text[], years_experience numeric, visa_types text[], work_type text, locations text[], hourly_rate_min numeric, hourly_rate_max numeric, relocation_required boolean, post_source text, created_by_account_id uuid, created_by_user_id uuid, author_display_name text, avatar_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
begin
  return query
with   eligible as (
    select
      src.*,
      case
        when nullif(btrim(coalesce(p_query, '')), '') is null then null
        else ts_rank_cd(src.search_document, websearch_to_tsquery('english', btrim(p_query)))
      end as search_rank
    from public.pulse_feed_hotlist_rows_keyed src
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      -- Only posters the viewer subscribes to.
      and public.publisher_email_key(src.poster_email) in (
        select p.email
        from public.publisher_follows f
        join public.publisher_profiles p on p.id = f.publisher_id
        where f.account_id = public.publisher_account_for_user(auth.uid())
      )
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
end;
$function$;
