-- Performance pass on the paged feed.
--
-- Measured on the live 30-day window (21k rows): the page RPC took 3.4s and
-- the facets RPC ~40s. Two causes, both fixed here.
--
-- 1. The filter predicate was a single SQL function taking every row column.
--    Postgres can't inline a function containing EXISTS subqueries, so it ran
--    per row even when no filter was set — the common case. Inlined here, each
--    clause constant-folds away at plan time when its parameter is null.
--
-- 2. The facet CTE was inlined by the planner, so the regex-heavy facet
--    helpers were re-evaluated once per referencing branch (five of them).
--    It is MATERIALIZED now, carrying only the derived values.
--
-- The de-duplication key is still computed per row per query; if this is still
-- too slow, that is the next thing to precompute with a trigger the way
-- search_document already is.

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
  with q as (
    select websearch_to_tsquery('english', btrim(p_query)) as tsq
    where nullif(btrim(coalesce(p_query, '')), '') is not null
  ),
  eligible as (
    select
      src.*,
      case when q.tsq is null then null else ts_rank_cd(src.search_document, q.tsq) end as search_rank
    from public.pulse_feed_jobs_rows_keyed src
    left join q on true
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (q.tsq is null or src.search_document @@ q.tsq)
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
  offset case
    when nullif(btrim(coalesce(p_query, '')), '') is null then 0
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
  with q as (
    select websearch_to_tsquery('english', btrim(p_query)) as tsq
    where nullif(btrim(coalesce(p_query, '')), '') is not null
  ),
  eligible as (
    select
      src.*,
      case when q.tsq is null then null else ts_rank_cd(src.search_document, q.tsq) end as search_rank
    from public.pulse_feed_hotlist_rows_keyed src
    left join q on true
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (q.tsq is null or src.search_document @@ q.tsq)
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
  offset case
    when nullif(btrim(coalesce(p_query, '')), '') is null then 0
    else greatest(0, coalesce(p_offset, 0))
  end;
$$;


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
      public.pulse_facet_work_type(src.score_breakdown) as f_work_type,
      public.pulse_facet_employment_type(src.score_breakdown, src.employment_type) as f_employment_type,
      public.pulse_facet_visa_status(src.score_breakdown, src.extracted_visa_types) as f_visa_status,
      public.pulse_facet_experience_years(src.score_breakdown, src.extracted_experience_years, src.seniority_level) as f_experience_years,
      public.pulse_facet_location(src.score_breakdown, src.location) as f_location,
      public.pulse_facet_skills(src.score_breakdown, src.extracted_skills) as f_skills,
      public.pulse_facet_rate_value(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) as f_rate_value,
      public.pulse_facet_has_rate(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) as f_has_rate
    from public.pulse_feed_jobs_rows_keyed src
    left join q on true
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (q.tsq is null or src.search_document @@ q.tsq)
  ),
  -- MATERIALIZED on purpose. Every facet value is derived by a regex-heavy
  -- immutable function; without this the planner inlines the CTE and
  -- re-evaluates them once per referencing branch below, which is what made
  -- this RPC take ~40s over a 30-day window. Only the narrow derived columns
  -- are carried, never post_content, so the materialised set stays small.
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
  -- The per-category keep flags, each ignoring its own category so selecting
  -- an option never shrinks that option's own count.
  keep as (
    select
      vals.*,
      (coalesce(array_length(p_locations, 1), 0) = 0
        or exists (select 1 from unnest(p_locations) as loc where vals.f_location like '%' || public.pulse_normalize(loc) || '%'))
      and (nullif(btrim(coalesce(p_skills_query, '')), '') is null
        or vals.f_skills like '%' || public.pulse_normalize(p_skills_query) || '%')
      and (p_rate_mode is distinct from 'has_rate' or vals.f_has_rate)
      and (p_rate_mode is distinct from 'range' or (
        vals.f_rate_value is not null
        and (p_rate_min is null or vals.f_rate_value >= p_rate_min)
        and (p_rate_max is null or vals.f_rate_value <= p_rate_max)
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
      public.pulse_facet_work_type(src.score_breakdown) as f_work_type,
      public.pulse_facet_employment_type(src.score_breakdown, src.employment_type) as f_employment_type,
      public.pulse_facet_visa_status(src.score_breakdown, src.extracted_visa_types) as f_visa_status,
      public.pulse_facet_experience_years(src.score_breakdown, src.extracted_experience_years, src.seniority_level) as f_experience_years,
      public.pulse_facet_location(src.score_breakdown, src.location) as f_location,
      public.pulse_facet_skills(src.score_breakdown, src.extracted_skills) as f_skills,
      public.pulse_facet_rate_value(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) as f_rate_value,
      public.pulse_facet_has_rate(src.score_breakdown, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max, src.salary_range) as f_has_rate
    from public.pulse_feed_hotlist_rows_keyed src
    left join q on true
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (q.tsq is null or src.search_document @@ q.tsq)
  ),
  -- MATERIALIZED on purpose. Every facet value is derived by a regex-heavy
  -- immutable function; without this the planner inlines the CTE and
  -- re-evaluates them once per referencing branch below, which is what made
  -- this RPC take ~40s over a 30-day window. Only the narrow derived columns
  -- are carried, never post_content, so the materialised set stays small.
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
  -- The per-category keep flags, each ignoring its own category so selecting
  -- an option never shrinks that option's own count.
  keep as (
    select
      vals.*,
      (coalesce(array_length(p_locations, 1), 0) = 0
        or exists (select 1 from unnest(p_locations) as loc where vals.f_location like '%' || public.pulse_normalize(loc) || '%'))
      and (nullif(btrim(coalesce(p_skills_query, '')), '') is null
        or vals.f_skills like '%' || public.pulse_normalize(p_skills_query) || '%')
      and (p_rate_mode is distinct from 'has_rate' or vals.f_has_rate)
      and (p_rate_mode is distinct from 'range' or (
        vals.f_rate_value is not null
        and (p_rate_min is null or vals.f_rate_value >= p_rate_min)
        and (p_rate_max is null or vals.f_rate_value <= p_rate_max)
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
