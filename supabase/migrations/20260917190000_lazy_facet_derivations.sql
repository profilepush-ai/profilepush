-- Only derive what the query actually needs.
--
-- The facet RPC computed eight derived values per row. Four of them (location,
-- skills and the rate text) are only ever used to narrow the set and are never
-- counted, so on an unfiltered feed -- the common case -- half the work was
-- thrown away. They are now guarded by a CASE on their own parameter; the
-- parameters are constants for the query, so the planner drops the branch and
-- the helper is never called.

create or replace function public.get_pulse_social_feed_facets(
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
  windowed as (
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
    left join q on true
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (q.tsq is null or src.search_document @@ q.tsq)
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
$$;

create or replace function public.get_social_hotlist_feed_facets(
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
  windowed as (
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
    left join q on true
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (q.tsq is null or src.search_document @@ q.tsq)
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
$$;
