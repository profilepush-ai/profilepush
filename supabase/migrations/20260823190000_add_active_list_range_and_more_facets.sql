-- Two changes to the Active List RPCs:
-- 1. The activity window becomes a parameter (p_hours_back), defaulting to
--    72 (3 days) to match /jobs' own default range, instead of a hardcoded
--    24 hours. The public preview pages (via active-list-cache) explicitly
--    pass 24 to keep their existing "last 24 hours" copy accurate.
-- 2. Adds skills/location/rate fields so the /active-list sidebar can offer
--    the same filter set as /jobs' sidebar (Location text input, Skills
--    text input, Rate range) alongside the facets added in the previous
--    migration (Employment Type, Work Type, Visa, Experience).
--
-- Column names differ across the two source tables:
--   social_jobs: extracted_skills (jsonb), location (text),
--                extracted_hourly_rate_min/max (numeric)
--   social_hotlist: core_skills (text[]), locations (text[]),
--                   hourly_rate_min/max (numeric)
--
-- CREATE OR REPLACE can't change a function's return columns, so drop first.
DROP FUNCTION IF EXISTS public.get_active_list_recruiter_contacts_24h();
DROP FUNCTION IF EXISTS public.get_active_list_vendor_contacts_24h();

CREATE FUNCTION public.get_active_list_recruiter_contacts_24h(p_hours_back integer DEFAULT 72)
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
  hourly_rate_max numeric[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    email,
    (array_agg(name ORDER BY active_at DESC))[1],
    MAX(active_at),
    array_agg(DISTINCT NULLIF(role, '')) FILTER (WHERE role <> ''),
    array_agg(DISTINCT NULLIF(employment_type, '')) FILTER (WHERE employment_type <> ''),
    ARRAY[]::text[],
    array_agg(DISTINCT visa) FILTER (WHERE visa IS NOT NULL AND visa <> ''),
    array_agg(DISTINCT exp_years) FILTER (WHERE exp_years IS NOT NULL),
    array_agg(DISTINCT skill) FILTER (WHERE skill IS NOT NULL AND skill <> ''),
    array_agg(DISTINCT NULLIF(location, '')) FILTER (WHERE location <> ''),
    array_agg(DISTINCT rate_min) FILTER (WHERE rate_min IS NOT NULL),
    array_agg(DISTINCT rate_max) FILTER (WHERE rate_max IS NOT NULL)
  FROM (
    SELECT
      NULLIF(TRIM(SPLIT_PART(sj.poster_email, ',', 1)), '') AS email,
      sj.posted_by_name AS name,
      COALESCE(sj.posted_at, sj.created_at) AS active_at,
      sj.job_title AS role,
      sj.employment_type AS employment_type,
      v.value AS visa,
      sj.extracted_experience_years::numeric AS exp_years,
      s.value AS skill,
      sj.location AS location,
      sj.extracted_hourly_rate_min AS rate_min,
      sj.extracted_hourly_rate_max AS rate_max
    FROM public.social_jobs sj
    LEFT JOIN LATERAL jsonb_array_elements_text(sj.extracted_visa_types) AS v(value) ON true
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

CREATE FUNCTION public.get_active_list_vendor_contacts_24h(p_hours_back integer DEFAULT 72)
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
  hourly_rate_max numeric[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    email,
    (array_agg(name ORDER BY active_at DESC))[1],
    MAX(active_at),
    array_agg(DISTINCT NULLIF(role, '')) FILTER (WHERE role <> ''),
    array_agg(DISTINCT NULLIF(employment_type, '')) FILTER (WHERE employment_type <> ''),
    array_agg(DISTINCT NULLIF(work_type, '')) FILTER (WHERE work_type <> ''),
    array_agg(DISTINCT NULLIF(visa, '')) FILTER (WHERE visa <> ''),
    array_agg(DISTINCT exp_years) FILTER (WHERE exp_years IS NOT NULL),
    array_agg(DISTINCT skill) FILTER (WHERE skill IS NOT NULL AND skill <> ''),
    array_agg(DISTINCT location) FILTER (WHERE location IS NOT NULL AND location <> ''),
    array_agg(DISTINCT rate_min) FILTER (WHERE rate_min IS NOT NULL),
    array_agg(DISTINCT rate_max) FILTER (WHERE rate_max IS NOT NULL)
  FROM (
    SELECT
      NULLIF(TRIM(SPLIT_PART(sh.bench_sales_recruiter_email, ',', 1)), '') AS email,
      sh.bench_sales_recruiter_name AS name,
      COALESCE(sh.posted_at, sh.created_at) AS active_at,
      sh.role_title AS role,
      sh.employment_type AS employment_type,
      sh.work_type AS work_type,
      sh.visa_type AS visa,
      sh.years_experience AS exp_years,
      s.value AS skill,
      loc.value AS location,
      sh.hourly_rate_min AS rate_min,
      sh.hourly_rate_max AS rate_max
    FROM public.social_hotlist sh
    LEFT JOIN LATERAL unnest(sh.core_skills) AS s(value) ON true
    LEFT JOIN LATERAL unnest(sh.locations) AS loc(value) ON true
    WHERE sh.post_source = 'linkedin_scrape'
      AND sh.hidden_at IS NULL
      AND sh.bench_sales_recruiter_email <> ''
      AND sh.created_at >= now() - (GREATEST(COALESCE(p_hours_back, 72), 1) || ' hours')::interval
  ) sub
  WHERE email IS NOT NULL
  GROUP BY email
  ORDER BY 3 DESC;
$$;

REVOKE ALL ON FUNCTION public.get_active_list_recruiter_contacts_24h(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_active_list_vendor_contacts_24h(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_list_recruiter_contacts_24h(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_list_vendor_contacts_24h(integer) TO service_role;
