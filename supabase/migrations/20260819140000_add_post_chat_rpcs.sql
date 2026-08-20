-- Write/read-support path for per-post chat. All SECURITY DEFINER,
-- authenticated-only, always resolving the caller's account server-side.

CREATE OR REPLACE FUNCTION public.start_post_chat_thread(
  p_post_kind text,
  p_post_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_display_name text;
  v_invited_email text;
  v_owner_account_id uuid;
  v_owner_user_id uuid;
  v_owner_display_name text;
  v_subject text;
  v_thread_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_post_kind NOT IN ('job', 'hotlist') THEN
    RAISE EXCEPTION 'Invalid post kind';
  END IF;

  SELECT am.account_id, am.display_name, am.invited_email INTO v_account_id, v_display_name, v_invited_email
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account membership found';
  END IF;

  IF p_post_kind = 'job' THEN
    SELECT created_by_account_id, created_by_user_id, COALESCE(NULLIF(TRIM(job_title), ''), 'Job post')
      INTO v_owner_account_id, v_owner_user_id, v_subject
      FROM public.social_jobs
      WHERE id = p_post_id AND post_source = 'user_post' AND hidden_at IS NULL AND post_status = 'open';
  ELSE
    SELECT created_by_account_id, created_by_user_id, COALESCE(NULLIF(TRIM(role_title), ''), 'Hotlist post')
      INTO v_owner_account_id, v_owner_user_id, v_subject
      FROM public.social_hotlist
      WHERE id = p_post_id AND post_source = 'user_post' AND hidden_at IS NULL AND post_status = 'open';
  END IF;

  IF v_owner_account_id IS NULL THEN
    RAISE EXCEPTION 'Post not found or no longer open';
  END IF;
  IF v_owner_account_id = v_account_id THEN
    RAISE EXCEPTION 'Cannot start a chat on your own post';
  END IF;

  SELECT COALESCE(
    (SELECT NULLIF(TRIM(am.display_name), '') FROM public.account_members am WHERE am.user_id = v_owner_user_id AND am.account_id = v_owner_account_id),
    (SELECT NULLIF(TRIM(a.name), '') FROM public.accounts a WHERE a.id = v_owner_account_id),
    'ProfilePush user'
  ) INTO v_owner_display_name;

  IF p_post_kind = 'job' THEN
    INSERT INTO public.post_chat_threads (post_kind, job_id, owner_account_id, owner_user_id, owner_display_name, participant_account_id, participant_user_id, participant_display_name, subject)
    VALUES ('job', p_post_id, v_owner_account_id, v_owner_user_id, v_owner_display_name, v_account_id, auth.uid(), COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'), v_subject)
    ON CONFLICT (job_id, participant_account_id) WHERE job_id IS NOT NULL DO NOTHING;

    SELECT id INTO v_thread_id FROM public.post_chat_threads WHERE job_id = p_post_id AND participant_account_id = v_account_id;
  ELSE
    INSERT INTO public.post_chat_threads (post_kind, hotlist_id, owner_account_id, owner_user_id, owner_display_name, participant_account_id, participant_user_id, participant_display_name, subject)
    VALUES ('hotlist', p_post_id, v_owner_account_id, v_owner_user_id, v_owner_display_name, v_account_id, auth.uid(), COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'), v_subject)
    ON CONFLICT (hotlist_id, participant_account_id) WHERE hotlist_id IS NOT NULL DO NOTHING;

    SELECT id INTO v_thread_id FROM public.post_chat_threads WHERE hotlist_id = p_post_id AND participant_account_id = v_account_id;
  END IF;

  RETURN v_thread_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_post_chat_thread(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_post_chat_thread(text, uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.send_post_chat_message(
  p_thread_id uuid,
  p_body text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_display_name text;
  v_invited_email text;
  v_thread record;
  v_body text;
  v_message_id uuid;
  v_recipient_user_id uuid;
  v_recent_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_body := TRIM(COALESCE(p_body, ''));
  IF v_body = '' THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;
  IF length(v_body) > 4000 THEN
    RAISE EXCEPTION 'Message is too long';
  END IF;

  SELECT am.account_id, am.display_name, am.invited_email INTO v_account_id, v_display_name, v_invited_email
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account membership found';
  END IF;

  SELECT * INTO v_thread FROM public.post_chat_threads WHERE id = p_thread_id;
  IF v_thread.id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;
  IF v_account_id NOT IN (v_thread.owner_account_id, v_thread.participant_account_id) THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  SELECT count(*) INTO v_recent_count
    FROM public.post_chat_messages
    WHERE sender_account_id = v_account_id AND created_at >= now() - interval '1 minute';
  IF v_recent_count >= 30 THEN
    RAISE EXCEPTION 'You are sending messages too quickly — please slow down';
  END IF;

  INSERT INTO public.post_chat_messages (thread_id, sender_account_id, sender_user_id, sender_display_name, body)
  VALUES (p_thread_id, v_account_id, auth.uid(), COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'), v_body)
  RETURNING id INTO v_message_id;

  IF v_account_id = v_thread.owner_account_id THEN
    UPDATE public.post_chat_threads
    SET last_message_at = now(), last_message_preview = LEFT(v_body, 140), updated_at = now(),
        participant_unread_count = participant_unread_count + 1
    WHERE id = p_thread_id;
    v_recipient_user_id := v_thread.participant_user_id;
  ELSE
    UPDATE public.post_chat_threads
    SET last_message_at = now(), last_message_preview = LEFT(v_body, 140), updated_at = now(),
        owner_unread_count = owner_unread_count + 1
    WHERE id = p_thread_id;
    v_recipient_user_id := v_thread.owner_user_id;
  END IF;

  IF v_recipient_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (account_id, user_id, type, title, body, link)
    VALUES (
      CASE WHEN v_account_id = v_thread.owner_account_id THEN v_thread.participant_account_id ELSE v_thread.owner_account_id END,
      v_recipient_user_id,
      'post_message_received',
      'New message about "' || v_thread.subject || '"',
      LEFT(v_body, 140),
      '/posts/messages/' || p_thread_id::text
    );
  END IF;

  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_post_chat_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_post_chat_message(uuid, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.mark_post_chat_thread_read(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_thread record;
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

  SELECT * INTO v_thread FROM public.post_chat_threads WHERE id = p_thread_id;
  IF v_thread.id IS NULL THEN
    RETURN;
  END IF;

  IF v_account_id = v_thread.owner_account_id THEN
    UPDATE public.post_chat_threads SET owner_unread_count = 0 WHERE id = p_thread_id;
  ELSIF v_account_id = v_thread.participant_account_id THEN
    UPDATE public.post_chat_threads SET participant_unread_count = 0 WHERE id = p_thread_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_post_chat_thread_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_post_chat_thread_read(uuid) TO authenticated;


