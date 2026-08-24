-- Extends the Active List RPCs with the fields needed for a /jobs-style
-- faceted filter sidebar (experience, work type, employment type, visa),
-- aggregated per contact the same way role_titles already is. social_jobs
-- has no work_type column (only social_hotlist does), so the recruiters RPC
-- always returns an empty work_types array — that facet is naturally a
-- no-op on that tab rather than showing wrong data.
--
-- CREATE OR REPLACE can't change a function's return columns, so drop first.
DROP FUNCTION IF EXISTS public.get_active_list_recruiter_contacts_24h();
DROP FUNCTION IF EXISTS public.get_active_list_vendor_contacts_24h();

CREATE FUNCTION public.get_active_list_recruiter_contacts_24h()
RETURNS TABLE (
  contact_email text,
  contact_name text,
  last_active_at timestamptz,
  role_titles text[],
  employment_types text[],
  work_types text[],
  visa_types text[],
  experience_years numeric[]
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
    array_agg(DISTINCT exp_years) FILTER (WHERE exp_years IS NOT NULL)
  FROM (
    SELECT
      NULLIF(TRIM(SPLIT_PART(sj.poster_email, ',', 1)), '') AS email,
      sj.posted_by_name AS name,
      COALESCE(sj.posted_at, sj.created_at) AS active_at,
      sj.job_title AS role,
      sj.employment_type AS employment_type,
      v.value AS visa,
      sj.extracted_experience_years::numeric AS exp_years
    FROM public.social_jobs sj
    LEFT JOIN LATERAL jsonb_array_elements_text(sj.extracted_visa_types) AS v(value) ON true
    WHERE sj.post_source = 'linkedin_scrape'
      AND sj.hidden_at IS NULL
      AND sj.poster_email <> ''
      AND sj.created_at >= now() - interval '24 hours'
  ) sub
  WHERE email IS NOT NULL
  GROUP BY email
  ORDER BY 3 DESC;
$$;

CREATE FUNCTION public.get_active_list_vendor_contacts_24h()
RETURNS TABLE (
  contact_email text,
  contact_name text,
  last_active_at timestamptz,
  role_titles text[],
  employment_types text[],
  work_types text[],
  visa_types text[],
  experience_years numeric[]
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
    array_agg(DISTINCT exp_years) FILTER (WHERE exp_years IS NOT NULL)
  FROM (
    SELECT
      NULLIF(TRIM(SPLIT_PART(sh.bench_sales_recruiter_email, ',', 1)), '') AS email,
      sh.bench_sales_recruiter_name AS name,
      COALESCE(sh.posted_at, sh.created_at) AS active_at,
      sh.role_title AS role,
      sh.employment_type AS employment_type,
      sh.work_type AS work_type,
      sh.visa_type AS visa,
      sh.years_experience AS exp_years
    FROM public.social_hotlist sh
    WHERE sh.post_source = 'linkedin_scrape'
      AND sh.hidden_at IS NULL
      AND sh.bench_sales_recruiter_email <> ''
      AND sh.created_at >= now() - interval '24 hours'
  ) sub
  WHERE email IS NOT NULL
  GROUP BY email
  ORDER BY 3 DESC;
$$;

REVOKE ALL ON FUNCTION public.get_active_list_recruiter_contacts_24h() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_active_list_vendor_contacts_24h() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_list_recruiter_contacts_24h() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_list_vendor_contacts_24h() TO service_role;
