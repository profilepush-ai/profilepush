-- Renames the "shortlisted" decision to "qualified" (clearer for reviewing
-- a screening video/summary), and adds a poster-initiated chat with the
-- recruiter who submitted the application — reuses the same
-- post_chat_threads mechanism/unique index as the existing Feed "Chat about
-- this post" button (participant_account_id is always the non-owner side,
-- so whichever side starts the thread first, the other reuses the same row).

ALTER TABLE public.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_status_check;
ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_status_check
  CHECK (status IN ('submitted', 'screening_sent', 'screening_completed', 'shortlisted', 'qualified', 'rejected'));

UPDATE public.job_applications SET status = 'qualified' WHERE status = 'shortlisted';

CREATE OR REPLACE FUNCTION public.set_job_application_decision(
  p_application_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_status NOT IN ('qualified', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT am.account_id INTO v_account_id
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account membership found';
  END IF;

  UPDATE public.job_applications ja
  SET status = p_status, updated_at = now()
  FROM public.social_jobs sj
  WHERE ja.id = p_application_id
    AND sj.id = ja.social_job_id
    AND sj.created_by_account_id = v_account_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_job_application_decision(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_job_application_decision(uuid, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.start_application_chat(p_application_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_display_name text;
  v_invited_email text;
  v_social_job_id uuid;
  v_submitter_account_id uuid;
  v_submitter_user_id uuid;
  v_job_title text;
  v_submitter_display_name text;
  v_thread_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT am.account_id, am.display_name, am.invited_email INTO v_account_id, v_display_name, v_invited_email
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account membership found';
  END IF;

  SELECT ja.social_job_id, ja.created_by_account_id, ja.created_by_user_id
    INTO v_social_job_id, v_submitter_account_id, v_submitter_user_id
    FROM public.job_applications ja
    WHERE ja.id = p_application_id;

  IF v_social_job_id IS NULL THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  SELECT job_title INTO v_job_title FROM public.social_jobs
    WHERE id = v_social_job_id AND created_by_account_id = v_account_id;

  IF v_job_title IS NULL THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  IF v_submitter_account_id = v_account_id THEN
    RAISE EXCEPTION 'Cannot start a chat with yourself';
  END IF;

  SELECT COALESCE(
    (SELECT NULLIF(TRIM(am.display_name), '') FROM public.account_members am WHERE am.user_id = v_submitter_user_id AND am.account_id = v_submitter_account_id),
    (SELECT NULLIF(TRIM(a.name), '') FROM public.accounts a WHERE a.id = v_submitter_account_id),
    'ProfilePush user'
  ) INTO v_submitter_display_name;

  -- Same (job_id, participant_account_id) row the Feed's own "Chat about
  -- this post" button would create if the submitter opened it first — the
  -- poster initiating here just reuses/creates it from the other side.
  INSERT INTO public.post_chat_threads (
    post_kind, job_id, owner_account_id, owner_user_id, owner_display_name,
    participant_account_id, participant_user_id, participant_display_name, subject
  )
  VALUES (
    'job', v_social_job_id, v_account_id, auth.uid(),
    COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'),
    v_submitter_account_id, v_submitter_user_id, v_submitter_display_name,
    COALESCE(NULLIF(TRIM(v_job_title), ''), 'Job post')
  )
  ON CONFLICT (job_id, participant_account_id) WHERE job_id IS NOT NULL DO NOTHING;

  SELECT id INTO v_thread_id FROM public.post_chat_threads
    WHERE job_id = v_social_job_id AND participant_account_id = v_submitter_account_id;

  RETURN v_thread_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_application_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_application_chat(uuid) TO authenticated;
