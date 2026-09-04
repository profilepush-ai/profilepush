-- Public (no-login) lookups for a single job or hotlist lead, so a card in
-- the Feed can be shared as a link to social media etc. and still resolve
-- for an anonymous visitor. social_jobs/social_hotlist themselves stay
-- locked to `authenticated` only (per 20260816110000/20260811140000) — these
-- SECURITY DEFINER RPCs are the sanctioned narrow opening, and deliberately
-- omit poster/recruiter contact fields (email, phone, profile links,
-- internal account/user ids) so a public link can't be used to scrape
-- contact info. Applying still requires a real login (submit_job_application
-- already enforces that), this just lets the *page* render before that.

CREATE OR REPLACE FUNCTION public.get_public_job_lead(p_id uuid)
RETURNS TABLE (
  id uuid,
  job_title text,
  company_name text,
  location text,
  employment_type text,
  seniority_level text,
  job_description text,
  salary_range text,
  extracted_skills jsonb,
  extracted_experience_years integer,
  extracted_visa_types jsonb,
  extracted_hourly_rate_min numeric,
  extracted_hourly_rate_max numeric,
  post_source text,
  post_status text,
  post_url text,
  avatar_url text,
  posted_by_name text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    sj.id, sj.job_title, sj.company_name, sj.location, sj.employment_type,
    sj.seniority_level, sj.job_description, sj.salary_range, sj.extracted_skills,
    sj.extracted_experience_years, sj.extracted_visa_types, sj.extracted_hourly_rate_min,
    sj.extracted_hourly_rate_max, sj.post_source, sj.post_status, sj.post_url,
    sj.avatar_url, sj.posted_by_name, sj.created_at
  FROM public.social_jobs sj
  WHERE sj.id = p_id AND sj.hidden_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_public_job_lead(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_job_lead(uuid) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_public_hotlist_lead(p_id uuid)
RETURNS TABLE (
  id uuid,
  candidate_name text,
  role_title text,
  core_skills text[],
  years_experience numeric,
  visa_type text,
  employment_type text,
  work_type text,
  locations text[],
  hourly_rate_min numeric,
  hourly_rate_max numeric,
  availability text,
  candidate_summary text,
  bench_sales_company_name text,
  bench_sales_recruiter_avatar_url text,
  post_source text,
  post_status text,
  post_url text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    sh.id, sh.candidate_name, sh.role_title, sh.core_skills, sh.years_experience,
    sh.visa_type, sh.employment_type, sh.work_type, sh.locations, sh.hourly_rate_min,
    sh.hourly_rate_max, sh.availability, sh.candidate_summary, sh.bench_sales_company_name,
    sh.bench_sales_recruiter_avatar_url, sh.post_source, sh.post_status, sh.post_url, sh.created_at
  FROM public.social_hotlist sh
  WHERE sh.id = p_id AND sh.hidden_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_public_hotlist_lead(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_hotlist_lead(uuid) TO anon, authenticated;
