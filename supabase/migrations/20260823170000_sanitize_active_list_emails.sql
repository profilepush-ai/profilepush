-- Some scraped rows have bench_sales_recruiter_email/poster_email containing
-- multiple addresses joined by a comma (e.g. the extraction step pulled two
-- emails out of a post's text). That broke local/domain splitting downstream
-- (masking, CSV export) and leaked a fragment of the second address. Take
-- only the first comma-separated email and group by that sanitized value —
-- rows that only differ by their comma-joined junk should still merge into
-- the same contact.
CREATE OR REPLACE FUNCTION public.get_active_list_recruiter_contacts_24h()
RETURNS TABLE (
  contact_email text,
  contact_name text,
  last_active_at timestamptz,
  role_titles text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    email,
    (array_agg(name ORDER BY active_at DESC))[1],
    MAX(active_at),
    array_agg(DISTINCT NULLIF(role, '')) FILTER (WHERE role <> '')
  FROM (
    SELECT
      NULLIF(TRIM(SPLIT_PART(sj.poster_email, ',', 1)), '') AS email,
      sj.posted_by_name AS name,
      COALESCE(sj.posted_at, sj.created_at) AS active_at,
      sj.job_title AS role
    FROM public.social_jobs sj
    WHERE sj.post_source = 'linkedin_scrape'
      AND sj.hidden_at IS NULL
      AND sj.poster_email <> ''
      AND sj.created_at >= now() - interval '24 hours'
  ) sub
  WHERE email IS NOT NULL
  GROUP BY email
  ORDER BY 3 DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_active_list_vendor_contacts_24h()
RETURNS TABLE (
  contact_email text,
  contact_name text,
  last_active_at timestamptz,
  role_titles text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    email,
    (array_agg(name ORDER BY active_at DESC))[1],
    MAX(active_at),
    array_agg(DISTINCT NULLIF(role, '')) FILTER (WHERE role <> '')
  FROM (
    SELECT
      NULLIF(TRIM(SPLIT_PART(sh.bench_sales_recruiter_email, ',', 1)), '') AS email,
      sh.bench_sales_recruiter_name AS name,
      COALESCE(sh.posted_at, sh.created_at) AS active_at,
      sh.role_title AS role
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
