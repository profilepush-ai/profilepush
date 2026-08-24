-- Dedicated scalar-count companions to the row-returning Active List RPCs.
-- The row RPCs return TABLE and are subject to PostgREST's max_rows = 1000
-- cap (supabase/config.toml) — silently truncating past 1000 rows. A 30-day
-- window is expected to exceed that (the 7-day window alone already returns
-- 800+ vendor rows), so counting array.length on a row RPC's output would
-- silently undercount. These return a bare integer, not a TABLE, so they're
-- immune to max_rows — and skip the LATERAL joins the row RPCs need for
-- per-contact facets (visa/skills), since those don't affect a DISTINCT
-- email count, only the base table scan + the same sanitized-email WHERE
-- clause matter here.
--
-- Mirrors the current (post-20260823210000) table mapping: "vendor" reads
-- social_jobs/poster_email, "recruiter" reads social_hotlist/
-- bench_sales_recruiter_email — the names are the historical vendor/
-- recruiter labels, not the source table names.
CREATE OR REPLACE FUNCTION public.get_active_list_vendor_contact_count(p_hours_back integer DEFAULT 720)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM (
    SELECT DISTINCT NULLIF(TRIM(SPLIT_PART(sj.poster_email, ',', 1)), '') AS email
    FROM public.social_jobs sj
    WHERE sj.post_source = 'linkedin_scrape'
      AND sj.hidden_at IS NULL
      AND sj.poster_email <> ''
      AND sj.created_at >= now() - (GREATEST(COALESCE(p_hours_back, 720), 1) || ' hours')::interval
  ) sub
  WHERE sub.email IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_active_list_recruiter_contact_count(p_hours_back integer DEFAULT 720)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM (
    SELECT DISTINCT NULLIF(TRIM(SPLIT_PART(sh.bench_sales_recruiter_email, ',', 1)), '') AS email
    FROM public.social_hotlist sh
    WHERE sh.post_source = 'linkedin_scrape'
      AND sh.hidden_at IS NULL
      AND sh.bench_sales_recruiter_email <> ''
      AND sh.created_at >= now() - (GREATEST(COALESCE(p_hours_back, 720), 1) || ' hours')::interval
  ) sub
  WHERE sub.email IS NOT NULL;
$$;

-- Same lockdown pattern as 20260823161500_lock_down_active_list_rpcs.sql:
-- REVOKE must name PUBLIC, anon, AND authenticated explicitly. This project
-- has a default-privileges rule that auto-grants EXECUTE to anon/
-- authenticated at function-creation time — a bare `REVOKE ... FROM PUBLIC`
-- does NOT block them.
REVOKE ALL ON FUNCTION public.get_active_list_vendor_contact_count(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_active_list_recruiter_contact_count(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_list_vendor_contact_count(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_list_recruiter_contact_count(integer) TO service_role;
