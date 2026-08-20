-- Preview/chat engagement counts for a caller's own user-submitted posts, for
-- the Posts management page. pulse_lead_actions is RLS-scoped to the VIEWING
-- account (so a post owner can't read who viewed their post), and
-- post_chat_threads is scoped to owner-or-participant per row — both need a
-- SECURITY DEFINER aggregate rather than a client-side SELECT.
CREATE OR REPLACE FUNCTION public.get_my_post_metrics()
RETURNS TABLE (post_id uuid, preview_count integer, chat_count integer)
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
  WITH my_posts AS (
    SELECT sj.id FROM public.social_jobs sj
      WHERE sj.created_by_account_id = v_account_id AND sj.post_source = 'user_post'
    UNION ALL
    SELECT sh.id FROM public.social_hotlist sh
      WHERE sh.created_by_account_id = v_account_id AND sh.post_source = 'user_post'
  )
  SELECT
    p.id,
    (SELECT count(*)::integer FROM public.pulse_lead_actions a
      WHERE a.lead_id = p.id::text AND a.action_type = 'post_content_viewed'),
    (SELECT count(*)::integer FROM public.post_chat_threads t
      WHERE t.job_id = p.id OR t.hotlist_id = p.id)
  FROM my_posts p;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_post_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_post_metrics() TO authenticated;
