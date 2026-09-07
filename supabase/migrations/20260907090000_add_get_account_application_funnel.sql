-- Personal dashboard (replacing /pulse's old Market Pulse content) needs an
-- application-status funnel for the caller's own account. No existing RPC
-- aggregates job_applications by status — get_post_applications only
-- returns per-application rows for one post at a time. Follows the exact
-- same auth.uid() -> account_members resolution as get_my_post_metrics
-- (20260904120000_add_post_share_and_applications_rpcs.sql).
--
-- 'shortlisted' is folded into qualified_count: it was renamed to
-- 'qualified' in 20260904180000_add_qualify_and_application_chat.sql (all
-- existing rows were migrated then), kept only in the CHECK constraint for
-- backward compatibility — set_job_application_decision never writes it
-- anymore, so any stray 'shortlisted' row is legacy data, not a distinct
-- live status worth its own funnel stage.
CREATE OR REPLACE FUNCTION public.get_account_application_funnel()
RETURNS TABLE (
  total_applications integer,
  submitted_count integer,
  screening_sent_count integer,
  screening_completed_count integer,
  qualified_count integer,
  rejected_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT am.account_id INTO v_account_id
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account membership found';
  END IF;

  RETURN QUERY
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE ja.status = 'submitted')::integer,
    count(*) FILTER (WHERE ja.status = 'screening_sent')::integer,
    count(*) FILTER (WHERE ja.status = 'screening_completed')::integer,
    count(*) FILTER (WHERE ja.status IN ('qualified', 'shortlisted'))::integer,
    count(*) FILTER (WHERE ja.status = 'rejected')::integer
  FROM public.job_applications ja
  JOIN public.social_jobs sj ON sj.id = ja.social_job_id
  WHERE sj.created_by_account_id = v_account_id
    AND sj.post_source = 'user_post';
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_application_funnel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_application_funnel() TO authenticated;
