-- Adds "shared" as a trackable pulse_lead_actions type (same convention as
-- 'revealed'/'breakdown'/'post_content_viewed'), extends get_my_post_metrics
-- with share_count and application_count, and adds get_post_applications for
-- the new full-page Applications view (replacing the old in-modal list) —
-- returns richer per-application detail including who submitted it.

ALTER TABLE public.pulse_lead_actions
  DROP CONSTRAINT IF EXISTS pulse_lead_actions_action_type_check;
ALTER TABLE public.pulse_lead_actions
  ADD CONSTRAINT pulse_lead_actions_action_type_check
  CHECK (action_type IN ('revealed', 'breakdown', 'post_content_viewed', 'ignored', 'shared'));


DROP FUNCTION IF EXISTS public.get_my_post_metrics();

CREATE FUNCTION public.get_my_post_metrics()
RETURNS TABLE (post_id uuid, preview_count integer, chat_count integer, share_count integer, application_count integer)
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
    SELECT sj.id, 'job'::text AS kind FROM public.social_jobs sj
      WHERE sj.created_by_account_id = v_account_id AND sj.post_source = 'user_post'
    UNION ALL
    SELECT sh.id, 'hotlist'::text AS kind FROM public.social_hotlist sh
      WHERE sh.created_by_account_id = v_account_id AND sh.post_source = 'user_post'
  )
  SELECT
    p.id,
    (SELECT count(*)::integer FROM public.pulse_lead_actions a
      WHERE a.lead_id = p.id::text AND a.action_type = 'post_content_viewed'),
    (SELECT count(*)::integer FROM public.post_chat_threads t
      WHERE t.job_id = p.id OR t.hotlist_id = p.id),
    (SELECT count(*)::integer FROM public.pulse_lead_actions a
      WHERE a.lead_id = p.id::text AND a.action_type = 'shared'),
    (CASE WHEN p.kind = 'job' THEN
      (SELECT count(*)::integer FROM public.job_applications ja WHERE ja.social_job_id = p.id)
    ELSE 0 END)
  FROM my_posts p;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_post_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_post_metrics() TO authenticated;


CREATE OR REPLACE FUNCTION public.get_post_applications(p_social_job_id uuid)
RETURNS TABLE (
  id uuid,
  candidate_name text,
  candidate_email text,
  candidate_phone text,
  resume_url text,
  resume_file_name text,
  status text,
  ai_summary text,
  ai_score numeric,
  created_at timestamptz,
  applied_by_account_name text,
  applied_by_user_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_owns_job boolean;
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

  SELECT EXISTS(
    SELECT 1 FROM public.social_jobs sj
    WHERE sj.id = p_social_job_id AND sj.created_by_account_id = v_account_id
  ) INTO v_owns_job;

  IF NOT v_owns_job THEN
    RAISE EXCEPTION 'Job post not found';
  END IF;

  RETURN QUERY
  SELECT
    ja.id, ja.candidate_name, ja.candidate_email, ja.candidate_phone,
    ja.resume_url, ja.resume_file_name, ja.status, ja.ai_summary, ja.ai_score,
    ja.created_at,
    a.name,
    u.email::text
  FROM public.job_applications ja
  LEFT JOIN public.accounts a ON a.id = ja.created_by_account_id
  LEFT JOIN auth.users u ON u.id = ja.created_by_user_id
  WHERE ja.social_job_id = p_social_job_id
  ORDER BY ja.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_post_applications(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_post_applications(uuid) TO authenticated;

-- Note: job_application_screening_turns is read directly via the existing
-- select_job_application_screening_turns RLS policy (20260903110000) — no
-- new RPC needed there, same as the modal this page replaces already did.
