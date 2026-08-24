-- Powers the "Active List" feature (desktop nav page + two public SEO
-- landing pages): the 24h-active scraped contacts from social_jobs
-- (recruiters posting job requirements) and social_hotlist (vendors/bench
-- sales reps posting consultants). This is platform-wide PII across every
-- account, not scoped to the caller, so unlike get_my_post_metrics these are
-- service_role-only — never grantable to authenticated/anon. Callers are the
-- active-list edge function (full data, JWT-checked) and the
-- active-list-cache Cloudflare Worker (top-20 public preview).
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
    sj.poster_email,
    (array_agg(sj.posted_by_name ORDER BY COALESCE(sj.posted_at, sj.created_at) DESC))[1],
    MAX(COALESCE(sj.posted_at, sj.created_at)),
    array_agg(DISTINCT NULLIF(sj.job_title, '')) FILTER (WHERE sj.job_title <> '')
  FROM public.social_jobs sj
  WHERE sj.post_source = 'linkedin_scrape'
    AND sj.hidden_at IS NULL
    AND sj.poster_email <> ''
    AND sj.created_at >= now() - interval '24 hours'
  GROUP BY sj.poster_email
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
    sh.bench_sales_recruiter_email,
    (array_agg(sh.bench_sales_recruiter_name ORDER BY COALESCE(sh.posted_at, sh.created_at) DESC))[1],
    MAX(COALESCE(sh.posted_at, sh.created_at)),
    array_agg(DISTINCT NULLIF(sh.role_title, '')) FILTER (WHERE sh.role_title <> '')
  FROM public.social_hotlist sh
  WHERE sh.post_source = 'linkedin_scrape'
    AND sh.hidden_at IS NULL
    AND sh.bench_sales_recruiter_email <> ''
    AND sh.created_at >= now() - interval '24 hours'
  GROUP BY sh.bench_sales_recruiter_email
  ORDER BY 3 DESC;
$$;

REVOKE ALL ON FUNCTION public.get_active_list_recruiter_contacts_24h() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_list_vendor_contacts_24h() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_list_recruiter_contacts_24h() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_list_vendor_contacts_24h() TO service_role;
