-- Move the feed's de-duplication into SQL.
--
-- buildPulseLeadDedupKey in PulsePage.tsx collapses reposts of the same
-- listing. While the client held the whole window that was the last step
-- before rendering; with 100-row server pages it runs *after* the LIMIT, so a
-- page of 100 renders as ~85 and the totals are inflated by every duplicate in
-- the window. Both the page and the count have to dedupe before the limit.
--
-- Ported verbatim from dedupeText + buildPulseLeadDedupKey. Jobs collapse on
-- title|company|location|platform. Hotlists fold in poster identity and the
-- candidate index as well, because one hotlist post legitimately carries
-- several different consultants that share role, company and location.

create or replace function public.pulse_dedupe_text(p_input text)
returns text
language sql
immutable
parallel safe
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(public.pulse_normalize(p_input), 'https?://\S+', ' ', 'g'),
        '[^a-z0-9\s]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

-- SocialLead.title's fallback chain, which the dedupe key is built from.
create or replace function public.pulse_lead_title(
  p_job_title text,
  p_extracted_role_normalized text,
  p_post_content text,
  p_is_hotlist boolean
)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(
    nullif(btrim(coalesce(p_job_title, '')), ''),
    nullif(btrim(coalesce(p_extracted_role_normalized, '')), ''),
    nullif(left(split_part(btrim(coalesce(p_post_content, '')), E'\n', 1), 80), ''),
    case when p_is_hotlist then 'Available Consultant' else 'Untitled Job' end
  );
$$;

create or replace function public.pulse_lead_dedup_key(
  p_job_title text,
  p_extracted_role_normalized text,
  p_post_content text,
  p_company_name text,
  p_location text,
  p_platform text,
  p_is_hotlist boolean,
  p_poster_email text,
  p_poster_name text,
  p_score_breakdown jsonb,
  p_lead_id text
)
returns text
language sql
immutable
parallel safe
as $$
  with parts as (
    select
      public.pulse_dedupe_text(
        public.pulse_lead_title(p_job_title, p_extracted_role_normalized, p_post_content, p_is_hotlist)
      ) as title,
      public.pulse_dedupe_text(coalesce(p_company_name, '')) as company,
      public.pulse_dedupe_text(
        coalesce(nullif(btrim(coalesce(p_location, '')), ''), 'Location not specified')
      ) as location,
      public.pulse_dedupe_text(coalesce(p_platform, '')) as platform,
      public.pulse_dedupe_text(coalesce(p_poster_email, '')) as email,
      public.pulse_dedupe_text(coalesce(p_poster_name, '')) as poster,
      -- lead.candidateIndex comes off score_breakdown.hotlist_source, and is
      -- only used when it is a whole number; otherwise each row stands alone,
      -- which is what falling back to the id achieves.
      case
        when jsonb_typeof(p_score_breakdown -> 'hotlist_source') = 'object'
         and (p_score_breakdown -> 'hotlist_source' ->> 'candidate_index') ~ '^-?\d+$'
        then p_score_breakdown -> 'hotlist_source' ->> 'candidate_index'
        else p_lead_id
      end as candidate_slot
  )
  -- array_to_string with every element coalesced, not concat_ws: concat_ws
  -- drops NULL arguments, which would silently shift the key's fields. The
  -- JS builds a fixed-arity array and joins it, empty strings included.
  select case
    when p_is_hotlist then array_to_string(array[
      coalesce(title, ''),
      coalesce(company, ''),
      coalesce(nullif(location, ''), '-'),
      coalesce(nullif(platform, ''), '-'),
      coalesce(nullif(email, ''), nullif(poster, ''), '-'),
      coalesce(candidate_slot, '')
    ], '|')
    else array_to_string(array[
      coalesce(title, ''),
      coalesce(company, ''),
      coalesce(nullif(location, ''), '-'),
      coalesce(nullif(platform, ''), '-')
    ], '|')
  end
  from parts;
$$;


-- Key the feed rows without restating the 40-column view.
create or replace view public.pulse_feed_jobs_rows_keyed as
  select
    v.*,
    public.pulse_lead_dedup_key(
      v.job_title, v.extracted_role_normalized, v.post_content,
      v.company_name, v.location, v.platform,
      false, v.poster_email, v.posted_by_name,
      v.score_breakdown, v.lead_id
    ) as dedup_key
  from public.pulse_feed_jobs_rows v;

revoke all on public.pulse_feed_jobs_rows_keyed from public, anon, authenticated;

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
      and public.pulse_feed_row_matches_filters(
        src.score_breakdown, src.employment_type, src.extracted_visa_types,
        src.extracted_experience_years, src.seniority_level, src.location,
        src.extracted_skills, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max,
        src.salary_range,
        p_experience_ranges, p_work_types, p_employment_types, p_visa_statuses,
        p_locations, p_skills_query, p_rate_mode, p_rate_min, p_rate_max, null
      )
  ),
  -- De-duplicate before the LIMIT. Doing it after (as the client used to)
  -- turns a page of 100 into ~85 and inflates every total by the duplicates
  -- in the window. The survivor is the newest row for each key, matching the
  -- client's "keep the later postedAt" rule.
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


-- Key the feed rows without restating the 40-column view.
create or replace view public.pulse_feed_hotlist_rows_keyed as
  select
    v.*,
    public.pulse_lead_dedup_key(
      v.job_title, v.extracted_role_normalized, v.post_content,
      v.company_name, v.location, v.platform,
      true, v.poster_email, v.posted_by_name,
      v.score_breakdown, v.lead_id
    ) as dedup_key
  from public.pulse_feed_hotlist_rows v;

revoke all on public.pulse_feed_hotlist_rows_keyed from public, anon, authenticated;

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
      and public.pulse_feed_row_matches_filters(
        src.score_breakdown, src.employment_type, src.extracted_visa_types,
        src.extracted_experience_years, src.seniority_level, src.location,
        src.extracted_skills, src.extracted_hourly_rate_min, src.extracted_hourly_rate_max,
        src.salary_range,
        p_experience_ranges, p_work_types, p_employment_types, p_visa_statuses,
        p_locations, p_skills_query, p_rate_mode, p_rate_min, p_rate_max, null
      )
  ),
  -- De-duplicate before the LIMIT. Doing it after (as the client used to)
  -- turns a page of 100 into ~85 and inflates every total by the duplicates
  -- in the window. The survivor is the newest row for each key, matching the
  -- client's "keep the later postedAt" rule.
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

-- Facet counts, now over de-duplicated rows.
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
      src.score_breakdown, src.employment_type, src.extracted_visa_types,
      src.extracted_experience_years, src.seniority_level, src.location,
      src.extracted_skills, src.extracted_hourly_rate_min,
      src.extracted_hourly_rate_max, src.salary_range,
      row_number() over (
        partition by src.dedup_key
        order by src.effective_posted_at desc, src.lead_id desc
      ) as dedup_rank
    from public.pulse_feed_jobs_rows_keyed src
    left join q on true
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (q.tsq is null or src.search_document @@ q.tsq)
  ),
  -- Counts must be of de-duplicated rows, or the total reads high against a
  -- list the client has already collapsed.
  base as (
    select
      score_breakdown, employment_type, extracted_visa_types,
      extracted_experience_years, seniority_level, location,
      extracted_skills, extracted_hourly_rate_min,
      extracted_hourly_rate_max, salary_range
    from windowed
    where dedup_rank = 1
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
      src.score_breakdown, src.employment_type, src.extracted_visa_types,
      src.extracted_experience_years, src.seniority_level, src.location,
      src.extracted_skills, src.extracted_hourly_rate_min,
      src.extracted_hourly_rate_max, src.salary_range,
      row_number() over (
        partition by src.dedup_key
        order by src.effective_posted_at desc, src.lead_id desc
      ) as dedup_rank
    from public.pulse_feed_hotlist_rows_keyed src
    left join q on true
    where src.effective_posted_at >= coalesce(p_since, now() - interval '72 hours')
      and (q.tsq is null or src.search_document @@ q.tsq)
  ),
  -- Counts must be of de-duplicated rows, or the total reads high against a
  -- list the client has already collapsed.
  base as (
    select
      score_breakdown, employment_type, extracted_visa_types,
      extracted_experience_years, seniority_level, location,
      extracted_skills, extracted_hourly_rate_min,
      extracted_hourly_rate_max, salary_range
    from windowed
    where dedup_rank = 1
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
