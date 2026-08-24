-- Vendors tab's Experience/Work Type/Visa facets were showing all-zero on
-- /active-list even though /jobs shows real values for the same underlying
-- social_jobs posts. get_active_list_vendor_contacts_24h read
-- experience_years/visa_types straight off social_jobs.extracted_* (which the
-- scraper leaves null for nearly every row) and never populated work_types at
-- all (social_jobs has no work_type column).
--
-- Where /jobs actually gets this data (verified directly against the live
-- database, not assumed): PulsePage.tsx's getLeadFilterContext reads
-- radar_match_results.score_breakdown->'work_type_match'/'experience_match'/
-- 'visa_match' ->> 'job_value' — free text the AI matching pass writes for
-- every match it scores (e.g. "Onsite", "7+ years",
-- "H1 Transfer (Independent), US, GC, OPT, H4 EAD"). Spot-checked: 1159/1159
-- social matches in the last 72h have this populated, vs. the plain
-- radar_match_results.years_experience/work_type/visa_types columns, which
-- were populated during 2026-08-08 to 2026-08-12 only and have been 100%
-- empty since — a dead column, not a live source. score_breakdown is the
-- actual live source; this migration reads from it, with the (currently
-- dead but harmless to keep) plain columns and social_jobs' own raw columns
-- as fallback tiers in case those pipelines resume later.
CREATE OR REPLACE FUNCTION public.get_active_list_vendor_contacts_24h(p_hours_back integer DEFAULT 72)
RETURNS TABLE (
  contact_email text,
  contact_name text,
  last_active_at timestamptz,
  role_titles text[],
  employment_types text[],
  work_types text[],
  visa_types text[],
  experience_years numeric[],
  skills text[],
  locations text[],
  hourly_rate_min numeric[],
  hourly_rate_max numeric[],
  post_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_matches AS (
    -- One row per job post: its most recent radar_match_results match, if any.
    SELECT DISTINCT ON (matches.job_id)
      matches.job_id::text AS job_id,
      matches.years_experience AS years_experience_col,
      matches.work_type AS work_type_col,
      matches.visa_types AS visa_types_col,
      NULLIF(matches.score_breakdown -> 'work_type_match' ->> 'job_value', '') AS work_type_breakdown,
      NULLIF(matches.score_breakdown -> 'visa_match' ->> 'job_value', '') AS visa_breakdown,
      -- "7+ years", "12.5+ years", "1-8+ years" -> leading number; junk like
      -- "Mid-Level+ years" or "[object Object]+ years" has none, so NULL.
      (regexp_match(
        matches.score_breakdown -> 'experience_match' ->> 'job_value',
        '^(\d+(\.\d+)?)'
      ))[1]::numeric AS experience_breakdown
    FROM public.radar_match_results matches
    WHERE matches.job_source = 'social'
    ORDER BY matches.job_id, matches.created_at DESC
  )
  SELECT
    email,
    (array_agg(name ORDER BY active_at DESC))[1],
    MAX(active_at),
    array_agg(DISTINCT NULLIF(role, '')) FILTER (WHERE role <> ''),
    array_agg(DISTINCT NULLIF(employment_type, '')) FILTER (WHERE employment_type <> ''),
    array_agg(DISTINCT NULLIF(work_type, '')) FILTER (WHERE work_type <> ''),
    array_agg(DISTINCT visa) FILTER (WHERE visa IS NOT NULL AND visa <> ''),
    array_agg(DISTINCT exp_years) FILTER (WHERE exp_years IS NOT NULL),
    array_agg(DISTINCT skill) FILTER (WHERE skill IS NOT NULL AND skill <> ''),
    array_agg(DISTINCT NULLIF(location, '')) FILTER (WHERE location <> ''),
    array_agg(DISTINCT rate_min) FILTER (WHERE rate_min IS NOT NULL),
    array_agg(DISTINCT rate_max) FILTER (WHERE rate_max IS NOT NULL),
    COUNT(DISTINCT source_id)::integer
  FROM (
    SELECT
      sj.id AS source_id,
      NULLIF(TRIM(SPLIT_PART(sj.poster_email, ',', 1)), '') AS email,
      sj.posted_by_name AS name,
      COALESCE(sj.posted_at, sj.created_at) AS active_at,
      sj.job_title AS role,
      sj.employment_type AS employment_type,
      COALESCE(lm.work_type_breakdown, lm.work_type_col) AS work_type,
      v.value AS visa,
      COALESCE(lm.experience_breakdown, lm.years_experience_col, sj.extracted_experience_years::numeric) AS exp_years,
      s.value AS skill,
      sj.location AS location,
      sj.extracted_hourly_rate_min AS rate_min,
      sj.extracted_hourly_rate_max AS rate_max
    FROM public.social_jobs sj
    LEFT JOIN latest_matches lm ON lm.job_id = sj.id::text
    LEFT JOIN LATERAL unnest(
      CASE
        WHEN lm.visa_breakdown IS NOT NULL THEN ARRAY[lm.visa_breakdown]
        WHEN lm.visa_types_col IS NOT NULL AND array_length(lm.visa_types_col, 1) > 0 THEN lm.visa_types_col
        WHEN sj.extracted_visa_types IS NOT NULL AND jsonb_typeof(sj.extracted_visa_types) = 'array'
          THEN array(SELECT jsonb_array_elements_text(sj.extracted_visa_types))
        ELSE NULL
      END
    ) AS v(value) ON true
    LEFT JOIN LATERAL jsonb_array_elements_text(sj.extracted_skills) AS s(value) ON true
    WHERE sj.post_source = 'linkedin_scrape'
      AND sj.hidden_at IS NULL
      AND sj.poster_email <> ''
      AND sj.created_at >= now() - (GREATEST(COALESCE(p_hours_back, 72), 1) || ' hours')::interval
  ) sub
  WHERE email IS NOT NULL
  GROUP BY email
  ORDER BY 3 DESC;
$$;

-- CREATE OR REPLACE preserves prior grants, but re-asserting explicitly since
-- 20260823161500_lock_down_active_list_rpcs.sql's fix (this project
-- auto-grants EXECUTE to PUBLIC/anon/authenticated at function-creation time
-- regardless of prior REVOKEs) applies to every CREATE OR REPLACE, not just
-- the first CREATE.
REVOKE ALL ON FUNCTION public.get_active_list_vendor_contacts_24h(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_list_vendor_contacts_24h(integer) TO service_role;
