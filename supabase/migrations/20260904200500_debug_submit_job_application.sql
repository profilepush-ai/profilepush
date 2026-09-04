-- Temporary debug version (no exception swallowing) to surface the real
-- error from the chat-thread-creation block added in 20260904200000.
-- Will be replaced by a corrected, exception-safe version once diagnosed.
CREATE OR REPLACE FUNCTION public.submit_job_application(
  p_social_job_id uuid,
  p_candidate_name text DEFAULT '',
  p_candidate_email text DEFAULT '',
  p_candidate_phone text DEFAULT '',
  p_resume_url text DEFAULT '',
  p_resume_file_name text DEFAULT '',
  p_recruiter_note text DEFAULT '',
  p_resume_parsed_json jsonb DEFAULT NULL
)
RETURNS TABLE (id uuid, screening_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_display_name text;
  v_invited_email text;
  v_job_owner_account_id uuid;
  v_job_owner_user_id uuid;
  v_job_title text;
  v_owner_display_name text;
  v_new_id uuid;
  v_email text;
  v_screening_token text;
  v_thread_id uuid;
  v_candidate_label text;
  v_screening_url text;
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

  SELECT sj.created_by_account_id, sj.created_by_user_id, COALESCE(NULLIF(TRIM(sj.job_title), ''), 'this role')
    INTO v_job_owner_account_id, v_job_owner_user_id, v_job_title
    FROM public.social_jobs sj
    WHERE sj.id = p_social_job_id AND sj.hidden_at IS NULL;

  IF v_job_owner_account_id IS NULL THEN
    RAISE EXCEPTION 'Job post not found';
  END IF;

  IF COALESCE(TRIM(p_resume_url), '') = '' THEN
    RAISE EXCEPTION 'A resume upload is required';
  END IF;

  v_email := lower(TRIM(COALESCE(p_candidate_email, '')));
  IF v_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    v_email := '';
  END IF;

  INSERT INTO public.job_applications (
    social_job_id, created_by_account_id, created_by_user_id,
    candidate_name, candidate_email, candidate_phone,
    resume_url, resume_file_name, recruiter_note, resume_parsed_json, status
  ) VALUES (
    p_social_job_id, v_account_id, auth.uid(),
    LEFT(TRIM(COALESCE(p_candidate_name, '')), 200), v_email, LEFT(TRIM(COALESCE(p_candidate_phone, '')), 50),
    TRIM(p_resume_url), TRIM(COALESCE(p_resume_file_name, '')), LEFT(TRIM(COALESCE(p_recruiter_note, '')), 2000),
    p_resume_parsed_json, 'submitted'
  )
  RETURNING public.job_applications.id, public.job_applications.screening_token INTO v_new_id, v_screening_token;

  v_candidate_label := COALESCE(NULLIF(TRIM(p_candidate_name), ''), 'A candidate');
  v_screening_url := 'https://profilepush.ai/screen/' || v_screening_token;

  SELECT COALESCE(
    (SELECT NULLIF(TRIM(am.display_name), '') FROM public.account_members am WHERE am.user_id = v_job_owner_user_id AND am.account_id = v_job_owner_account_id),
    (SELECT NULLIF(TRIM(a.name), '') FROM public.accounts a WHERE a.id = v_job_owner_account_id),
    'ProfilePush user'
  ) INTO v_owner_display_name;

  INSERT INTO public.post_chat_threads (
    post_kind, job_id, application_id, owner_account_id, owner_user_id, owner_display_name,
    participant_account_id, participant_user_id, participant_display_name, subject
  ) VALUES (
    'application', p_social_job_id, v_new_id, v_job_owner_account_id, v_job_owner_user_id, v_owner_display_name,
    v_account_id, auth.uid(), COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'),
    v_job_title
  )
  RETURNING public.post_chat_threads.id INTO v_thread_id;

  UPDATE public.job_applications SET chat_thread_id = v_thread_id WHERE public.job_applications.id = v_new_id;

  INSERT INTO public.post_chat_messages (thread_id, sender_account_id, sender_user_id, sender_display_name, body)
  VALUES (
    v_thread_id, v_job_owner_account_id, v_job_owner_user_id, v_owner_display_name,
    'Thanks for submitting ' || v_candidate_label || ' for ' || v_job_title || '. Please make sure they complete the video screening: ' || v_screening_url
  );
  UPDATE public.post_chat_threads
    SET participant_unread_count = participant_unread_count + 1
    WHERE public.post_chat_threads.id = v_thread_id;

  INSERT INTO public.post_chat_messages (thread_id, sender_account_id, sender_user_id, sender_display_name, body)
  VALUES (
    v_thread_id, v_account_id, auth.uid(), COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'),
    'New application: ' || v_candidate_label || ' submitted for ' || v_job_title || '.'
  );
  UPDATE public.post_chat_threads
    SET owner_unread_count = owner_unread_count + 1, last_message_at = now(),
        last_message_preview = LEFT('New application: ' || v_candidate_label || ' submitted for ' || v_job_title || '.', 140)
    WHERE public.post_chat_threads.id = v_thread_id;

  IF v_job_owner_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (account_id, user_id, type, title, body, link)
    VALUES (
      v_job_owner_account_id, v_job_owner_user_id, 'post_message_received',
      'New application for "' || v_job_title || '"', 'From ' || v_candidate_label,
      '/posts/messages/' || v_thread_id::text
    );
  END IF;

  RETURN QUERY
  SELECT v_new_id, v_screening_token;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_job_application(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_job_application(uuid, text, text, text, text, text, text, jsonb) TO authenticated;
