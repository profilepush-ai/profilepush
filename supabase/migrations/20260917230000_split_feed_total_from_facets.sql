-- Split the result total out of the facet-count RPC.
--
-- The feed's "N results" came from the facets RPC, which also derives four
-- classifications per row for the sidebar breakdown. That work is spiky: warm
-- it runs in ~200ms-1.2s, but cold it reached 5.4s on a 30-day search and blew
-- the statement_timeout outright. When it failed the client had no total, and
-- the Recent tab silently fell back to counting the rows it had loaded --
-- reporting "100" for a window holding thousands.
--
-- The total needs none of that derivation when no filter is set, so it gets
-- its own RPC: one aggregate over the same view, with the same inlined filter
-- conditions so it can never disagree with the list it is counting. The
-- breakdown stays where it was and is allowed to be slower, because a stale
-- facet number is cosmetic in a way that a wrong result count is not.

create or replace function public.get_pulse_social_feed_total(
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
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  -- count(distinct dedup_key) rather than the window function the page uses:
  -- the number of surviving rows is the number of distinct keys, and this way
  -- there is no sort or row_number over the window.
  select count(distinct src.dedup_key)
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
      );
$$;

revoke all on function public.get_pulse_social_feed_total(
  timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
) from public;
grant execute on function public.get_pulse_social_feed_total(
  timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
) to authenticated, service_role;

create or replace function public.get_social_hotlist_feed_total(
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
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  -- count(distinct dedup_key) rather than the window function the page uses:
  -- the number of surviving rows is the number of distinct keys, and this way
  -- there is no sort or row_number over the window.
  select count(distinct src.dedup_key)
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
      );
$$;

revoke all on function public.get_social_hotlist_feed_total(
  timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
) from public;
grant execute on function public.get_social_hotlist_feed_total(
  timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric
) to authenticated, service_role;
