-- 20260904200000 added application-scoped threads (job_id + application_id
-- both set), but idx_post_chat_threads_job_participant was still scoped to
-- ANY row with a given (job_id, participant_account_id) regardless of
-- post_kind — so a new 'application' thread collided with a pre-existing
-- generic 'job' thread for the same (job, recruiter) pair (e.g. one created
-- earlier by start_application_chat, back when it made 'job'-kind threads).
-- Scope that index to post_kind = 'job' specifically so 'application'
-- threads (uniquely keyed by application_id instead) don't collide with it.

DROP INDEX IF EXISTS public.idx_post_chat_threads_job_participant;
CREATE UNIQUE INDEX idx_post_chat_threads_job_participant
  ON public.post_chat_threads (job_id, participant_account_id)
  WHERE job_id IS NOT NULL AND post_kind = 'job';

-- start_application_chat now resolves the application's OWN dedicated
-- thread (job_applications.chat_thread_id, set by submit_job_application)
-- instead of creating/reusing a generic 'job'-kind thread. Only applications
-- submitted before this feature existed won't have one yet — for those,
-- create an 'application'-kind thread on the fly and backfill the column.
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

  SELECT ja.social_job_id, ja.created_by_account_id, ja.created_by_user_id, ja.chat_thread_id
    INTO v_social_job_id, v_submitter_account_id, v_submitter_user_id, v_thread_id
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

  IF v_thread_id IS NOT NULL THEN
    RETURN v_thread_id;
  END IF;

  SELECT COALESCE(
    (SELECT NULLIF(TRIM(am.display_name), '') FROM public.account_members am WHERE am.user_id = v_submitter_user_id AND am.account_id = v_submitter_account_id),
    (SELECT NULLIF(TRIM(a.name), '') FROM public.accounts a WHERE a.id = v_submitter_account_id),
    'ProfilePush user'
  ) INTO v_submitter_display_name;

  INSERT INTO public.post_chat_threads (
    post_kind, job_id, application_id, owner_account_id, owner_user_id, owner_display_name,
    participant_account_id, participant_user_id, participant_display_name, subject
  )
  VALUES (
    'application', v_social_job_id, p_application_id, v_account_id, auth.uid(),
    COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'),
    v_submitter_account_id, v_submitter_user_id, v_submitter_display_name,
    COALESCE(NULLIF(TRIM(v_job_title), ''), 'Job post')
  )
  ON CONFLICT (application_id) WHERE application_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_thread_id;

  IF v_thread_id IS NULL THEN
    SELECT id INTO v_thread_id FROM public.post_chat_threads WHERE application_id = p_application_id;
  END IF;

  UPDATE public.job_applications SET chat_thread_id = v_thread_id WHERE id = p_application_id;

  RETURN v_thread_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_application_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_application_chat(uuid) TO authenticated;
