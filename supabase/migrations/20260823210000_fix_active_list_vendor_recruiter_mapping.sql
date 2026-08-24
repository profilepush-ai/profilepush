-- Correcting a mapping mistake made when this feature was first built: in
-- this platform, people POSTING JOB REQUIREMENTS (social_jobs) are
-- "vendors", and people POSTING HOTLIST/CONSULTANT LISTINGS (social_hotlist)
-- are "recruiters" — the exact opposite of what get_active_list_vendor_*
-- and get_active_list_recruiter_* queried until now. Swapping which table
-- each function reads from; names, parameters, and return shape are
-- unchanged, so every caller (active-list edge function, active-list-cache
-- worker, both public SEO pages) picks up the fix automatically without any
-- other code changes.
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

CREATE OR REPLACE FUNCTION public.get_active_list_recruiter_contacts_24h(p_hours_back integer DEFAULT 72)
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
    array_agg(DISTINCT rate_max) FILTER (WHERE rate_max IS NOT NULL),
    COUNT(DISTINCT source_id)::integer
  FROM (
    SELECT
      sh.id AS source_id,
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
