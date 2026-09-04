-- Every job application gets its own dedicated chat thread (not shared
-- across a recruiter's other applications to the same job — each candidate
-- submission is its own conversation), auto-seeded with two messages at
-- submission time, and kept alive with automated messages as the
-- application's status changes. This reuses the existing post_chat_threads/
-- post_chat_messages tables (same Inbox UI, same realtime subscription,
-- same unread-count mechanism) rather than a parallel messaging system.

ALTER TABLE public.post_chat_threads
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.job_applications(id) ON DELETE CASCADE;

ALTER TABLE public.post_chat_threads
  DROP CONSTRAINT IF EXISTS post_chat_threads_post_kind_check;
ALTER TABLE public.post_chat_threads
  ADD CONSTRAINT post_chat_threads_post_kind_check CHECK (post_kind IN ('job', 'hotlist', 'application'));

ALTER TABLE public.post_chat_threads
  DROP CONSTRAINT IF EXISTS post_chat_threads_kind_target_check;
ALTER TABLE public.post_chat_threads
  ADD CONSTRAINT post_chat_threads_kind_target_check CHECK (
    (post_kind = 'job' AND job_id IS NOT NULL AND hotlist_id IS NULL AND application_id IS NULL)
    OR (post_kind = 'hotlist' AND hotlist_id IS NOT NULL AND job_id IS NULL AND application_id IS NULL)
    OR (post_kind = 'application' AND application_id IS NOT NULL AND job_id IS NOT NULL AND hotlist_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_chat_threads_application
  ON public.post_chat_threads (application_id)
  WHERE application_id IS NOT NULL;

-- Lets a message carry an optional action button (e.g. "Watch Screening"),
-- rendered by the Inbox UI when both fields are present.
ALTER TABLE public.post_chat_messages
  ADD COLUMN IF NOT EXISTS cta_label text,
  ADD COLUMN IF NOT EXISTS cta_url text;

ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS chat_thread_id uuid REFERENCES public.post_chat_threads(id) ON DELETE SET NULL;


-- submit_job_application now also creates the application's chat thread and
-- seeds it with two messages: one from the poster (with the screening
-- link, so it's visible in-thread even though it was also emailed) and one
-- from the submitter announcing the new application (so it shows up as an
-- incoming message in the poster's inbox).
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

  -- Chat thread + seed messages — best-effort: an application must exist
  -- even if, for some reason, thread setup fails, so this never blocks the
  -- submission itself (the WHEN OTHERS handler below swallows any error
  -- from this block only).
  BEGIN
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

    -- Message 1: poster -> submitter, with the screening link.
    INSERT INTO public.post_chat_messages (thread_id, sender_account_id, sender_user_id, sender_display_name, body)
    VALUES (
      v_thread_id, v_job_owner_account_id, v_job_owner_user_id, v_owner_display_name,
      'Thanks for submitting ' || v_candidate_label || ' for ' || v_job_title || '. Please make sure they complete the video screening: ' || v_screening_url
    );
    UPDATE public.post_chat_threads
      SET participant_unread_count = participant_unread_count + 1
      WHERE public.post_chat_threads.id = v_thread_id;

    -- Message 2: submitter -> poster, the "new application" notice.
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
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN QUERY
  SELECT v_new_id, v_screening_token;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_job_application(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_job_application(uuid, text, text, text, text, text, text, jsonb) TO authenticated;


-- set_job_application_decision now also messages the submitter when a
-- candidate is qualified (rejected is no longer surfaced in the UI, so no
-- message path for it — the CHECK below still only allows the two values
-- the table itself supports).
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
  v_display_name text;
  v_invited_email text;
  v_updated integer;
  v_chat_thread_id uuid;
  v_candidate_name text;
  v_recipient_account_id uuid;
  v_recipient_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_status NOT IN ('qualified', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT am.account_id, am.display_name, am.invited_email INTO v_account_id, v_display_name, v_invited_email
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

  IF p_status = 'qualified' THEN
    BEGIN
      SELECT ja.chat_thread_id, ja.candidate_name, t.participant_account_id, t.participant_user_id
        INTO v_chat_thread_id, v_candidate_name, v_recipient_account_id, v_recipient_user_id
        FROM public.job_applications ja
        LEFT JOIN public.post_chat_threads t ON t.id = ja.chat_thread_id
        WHERE ja.id = p_application_id;

      IF v_chat_thread_id IS NOT NULL THEN
        INSERT INTO public.post_chat_messages (thread_id, sender_account_id, sender_user_id, sender_display_name, body)
        VALUES (
          v_chat_thread_id, v_account_id, auth.uid(),
          COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'),
          COALESCE(NULLIF(TRIM(v_candidate_name), ''), 'The candidate') || ' has been qualified — nice work!'
        );
        UPDATE public.post_chat_threads
          SET participant_unread_count = participant_unread_count + 1, last_message_at = now(),
              last_message_preview = LEFT(COALESCE(NULLIF(TRIM(v_candidate_name), ''), 'The candidate') || ' has been qualified — nice work!', 140)
          WHERE id = v_chat_thread_id;

        IF v_recipient_user_id IS NOT NULL THEN
          INSERT INTO public.notifications (account_id, user_id, type, title, body, link)
          VALUES (
            v_recipient_account_id, v_recipient_user_id, 'post_message_received',
            'Candidate qualified', COALESCE(NULLIF(TRIM(v_candidate_name), ''), 'The candidate') || ' was qualified',
            '/posts/messages/' || v_chat_thread_id::text
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_job_application_decision(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_job_application_decision(uuid, text) TO authenticated;
