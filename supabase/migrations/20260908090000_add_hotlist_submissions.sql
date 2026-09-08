-- "Submissions": lets a Bench Sales recruiter respond to a Vendor's resume
-- request (pulse_ask_ai_requests where hotlist_id is set) with an actual
-- resume, in-app. Today that request only ever triggers an outbound email
-- asking for it — nothing about the response is persisted anywhere, and
-- the hotlist post's owner has no way to even see requests made against
-- their own post (RLS only lets the requester see their own row). This
-- completes the already-half-built fulfillment lifecycle: 'fulfilled'
-- status and fulfilled_at/fulfillment_webhook_* columns already existed
-- with no code path ever setting them.

ALTER TABLE public.pulse_ask_ai_requests
  ADD COLUMN IF NOT EXISTS submission_resume_url text,
  ADD COLUMN IF NOT EXISTS submission_resume_file_name text,
  ADD COLUMN IF NOT EXISTS submission_note text;

-- Owner-side read — a scoped RPC rather than a raw RLS grant, matching how
-- every other "owner views responses to my post" feature in this codebase
-- works (e.g. get_post_applications for the Jobs side).
CREATE OR REPLACE FUNCTION public.get_hotlist_post_requests(p_hotlist_id uuid)
RETURNS TABLE (
  request_id uuid,
  status text,
  missing_details jsonb,
  submission_resume_url text,
  submission_resume_file_name text,
  submission_note text,
  fulfilled_at timestamptz,
  created_at timestamptz,
  requested_by_account_name text,
  requested_by_user_email text
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

  IF NOT EXISTS (
    SELECT 1 FROM public.social_hotlist sh
    WHERE sh.id = p_hotlist_id AND sh.created_by_account_id = v_account_id
  ) THEN
    RAISE EXCEPTION 'Not your hotlist post';
  END IF;

  RETURN QUERY
    SELECT
      r.request_id,
      r.status,
      r.missing_details,
      r.submission_resume_url,
      r.submission_resume_file_name,
      r.submission_note,
      r.fulfilled_at,
      r.created_at,
      COALESCE(am2.display_name, a.name),
      u.email::text
    FROM public.pulse_ask_ai_requests r
    JOIN public.accounts a ON a.id = r.account_id
    LEFT JOIN public.account_members am2 ON am2.account_id = r.account_id AND am2.user_id = r.user_id
    LEFT JOIN auth.users u ON u.id = r.user_id
    WHERE r.hotlist_id = p_hotlist_id
    ORDER BY r.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_hotlist_post_requests(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hotlist_post_requests(uuid) TO authenticated;

-- The response itself. No credit charge (matches submit_job_application —
-- only the original outbound request charges credits, not the reply).
CREATE OR REPLACE FUNCTION public.submit_hotlist_resume(
  p_request_id uuid,
  p_resume_url text,
  p_resume_file_name text DEFAULT '',
  p_response_note text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_hotlist_id uuid;
  v_requester_user_id uuid;
  v_requester_account_id uuid;
  v_role_title text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF COALESCE(TRIM(p_resume_url), '') = '' THEN
    RAISE EXCEPTION 'A resume upload is required';
  END IF;

  SELECT am.account_id INTO v_account_id
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  SELECT r.hotlist_id, r.user_id, r.account_id
    INTO v_hotlist_id, v_requester_user_id, v_requester_account_id
    FROM public.pulse_ask_ai_requests r
    WHERE r.request_id = p_request_id;

  IF v_hotlist_id IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.social_hotlist sh
    WHERE sh.id = v_hotlist_id AND sh.created_by_account_id = v_account_id
  ) THEN
    RAISE EXCEPTION 'Not your hotlist post';
  END IF;

  SELECT role_title INTO v_role_title FROM public.social_hotlist WHERE id = v_hotlist_id;

  UPDATE public.pulse_ask_ai_requests
  SET submission_resume_url = TRIM(p_resume_url),
      submission_resume_file_name = TRIM(COALESCE(p_resume_file_name, '')),
      submission_note = LEFT(TRIM(COALESCE(p_response_note, '')), 2000),
      status = 'fulfilled',
      fulfilled_at = now(),
      updated_at = now()
  WHERE request_id = p_request_id;

  -- Best-effort in-app notification — mirrors job_applications' decision
  -- flow (never blocks the submission itself if this fails).
  BEGIN
    INSERT INTO public.notifications (account_id, user_id, type, title, body, link)
    VALUES (
      v_requester_account_id,
      v_requester_user_id,
      'hotlist_resume_received',
      'Resume received',
      COALESCE(v_role_title, 'A hotlist request') || ' — resume submitted',
      '/tracker/requests'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_hotlist_resume(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_hotlist_resume(uuid, text, text, text) TO authenticated;

-- Extend the Vendor's own outbound view so a fulfilled resume actually
-- shows up in Tracker -> Requests. Changing RETURNS TABLE's column list
-- means CREATE OR REPLACE alone fails ("cannot change return type of
-- existing function") -- DROP first.
DROP FUNCTION IF EXISTS public.get_my_hotlist_ask_requests();

CREATE FUNCTION public.get_my_hotlist_ask_requests()
RETURNS TABLE (
  id uuid,
  hotlist_id uuid,
  role_title text,
  candidate_name text,
  company_name text,
  status text,
  created_at timestamptz,
  submission_resume_url text,
  submission_resume_file_name text,
  submission_note text,
  fulfilled_at timestamptz
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
    r.request_id,
    r.hotlist_id,
    sh.role_title,
    sh.candidate_name,
    sh.bench_sales_company_name,
    r.status,
    r.created_at,
    r.submission_resume_url,
    r.submission_resume_file_name,
    r.submission_note,
    r.fulfilled_at
  FROM public.pulse_ask_ai_requests r
  JOIN public.social_hotlist sh ON sh.id = r.hotlist_id
  WHERE r.account_id = v_account_id AND r.hotlist_id IS NOT NULL
  ORDER BY r.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_hotlist_ask_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_hotlist_ask_requests() TO authenticated;
