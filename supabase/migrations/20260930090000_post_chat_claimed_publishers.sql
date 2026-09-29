-- Chat from profile pages. Post chat only reached posts made in the app
-- (post_source = 'user_post'); a publisher who has joined also owns the posts
-- we imported for them, through their claimed profile, so those now reach
-- their account too. Unclaimed publishers still can't be chatted with.

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

    -- Imported posts have no owner account, but a publisher who has joined
    -- owns their profile: route the chat to that account.
    IF v_owner_account_id IS NULL THEN
      SELECT p.claimed_account_id, a.owner_id, COALESCE(NULLIF(TRIM(j.job_title), ''), 'Job post')
        INTO v_owner_account_id, v_owner_user_id, v_subject
        FROM public.social_jobs j
        JOIN public.publisher_profiles p ON p.email = public.publisher_email_key(j.poster_email)
        JOIN public.accounts a ON a.id = p.claimed_account_id
        WHERE j.id = p_post_id AND j.hidden_at IS NULL AND COALESCE(j.post_status, 'open') = 'open'
          AND p.claimed_account_id IS NOT NULL;
    END IF;
  ELSE
    SELECT created_by_account_id, created_by_user_id, COALESCE(NULLIF(TRIM(role_title), ''), 'Hotlist post')
      INTO v_owner_account_id, v_owner_user_id, v_subject
      FROM public.social_hotlist
      WHERE id = p_post_id AND post_source = 'user_post' AND hidden_at IS NULL AND post_status = 'open';

    IF v_owner_account_id IS NULL THEN
      SELECT p.claimed_account_id, a.owner_id, COALESCE(NULLIF(TRIM(h.role_title), ''), 'Hotlist post')
        INTO v_owner_account_id, v_owner_user_id, v_subject
        FROM public.social_hotlist h
        JOIN public.publisher_profiles p ON p.email = public.publisher_email_key(h.bench_sales_recruiter_email)
        JOIN public.accounts a ON a.id = p.claimed_account_id
        WHERE h.id = p_post_id AND h.hidden_at IS NULL AND COALESCE(h.post_status, 'open') = 'open'
          AND p.claimed_account_id IS NOT NULL;
    END IF;
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
