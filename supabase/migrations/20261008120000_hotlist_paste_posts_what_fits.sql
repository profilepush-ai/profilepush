/*
# Pasting a hotlist on the free plan posts what fits instead of nothing

The free plan allows 3 open consultants or requirements (enforce_free_post_limit,
20261005140000). create_user_hotlist_posts_batch inserted the whole paste in one
call, so the first consultant over the limit rolled back the entire paste: a
free user pasting 8 consultants got 0 posted and an error.

Now the paste saves consultants until the limit is reached and returns the ids
of those saved; the app compares that with what was pasted and tells the user
how many were left out. If none fit, it still raises the free-plan error. Every
other error (missing role title, too many skills, ...) fails exactly as before.

Unchanged apart from the BEGIN/EXCEPTION around the insert and the final check.
*/

CREATE OR REPLACE FUNCTION public.create_user_hotlist_posts_batch(
  p_candidates jsonb,
  p_post_content text DEFAULT '',
  p_contact_email text DEFAULT '',
  p_contact_phone text DEFAULT ''
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_display_name text;
  v_invited_email text;
  v_email text;
  v_auth_email text;
  v_avatar_url text;
  v_full_name text;
  v_recent_count integer;
  v_source_post_id text;
  v_candidate_count integer;
  v_post_scope text;
  v_candidate jsonb;
  v_index integer;
  v_new_id uuid;
  v_new_ids uuid[] := '{}';
  v_role_title text;
  v_core_skills text[];
  v_locations text[];
  v_limit_hit boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF jsonb_typeof(p_candidates) != 'array' THEN
    RAISE EXCEPTION 'p_candidates must be a JSON array';
  END IF;

  v_candidate_count := jsonb_array_length(p_candidates);
  IF v_candidate_count = 0 THEN
    RAISE EXCEPTION 'At least one candidate is required';
  END IF;
  IF v_candidate_count > 50 THEN
    RAISE EXCEPTION 'Too many candidates in one post — split into multiple posts';
  END IF;
  v_post_scope := CASE WHEN v_candidate_count = 1 THEN 'single' ELSE 'multiple' END;

  IF length(COALESCE(p_post_content, '')) > 8000 THEN
    RAISE EXCEPTION 'Post content is too long';
  END IF;

  SELECT am.account_id, am.display_name, am.invited_email
    INTO v_account_id, v_display_name, v_invited_email
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account membership found';
  END IF;

  SELECT (
    (SELECT count(*) FROM public.social_jobs WHERE created_by_account_id = v_account_id AND post_source = 'user_post' AND created_at >= now() - interval '24 hours')
    +
    (SELECT count(*) FROM public.social_hotlist WHERE created_by_account_id = v_account_id AND post_source = 'user_post' AND created_at >= now() - interval '24 hours')
  ) INTO v_recent_count;

  IF v_recent_count >= 20 THEN
    RAISE EXCEPTION 'You have reached the daily post limit — try again tomorrow';
  END IF;

  SELECT au.email,
    COALESCE(NULLIF(au.raw_user_meta_data->>'avatar_url', ''), NULLIF(au.raw_user_meta_data->>'picture', ''), ''),
    COALESCE(NULLIF(au.raw_user_meta_data->>'full_name', ''), NULLIF(au.raw_user_meta_data->>'name', ''), '')
    INTO v_auth_email, v_avatar_url, v_full_name
    FROM auth.users au WHERE au.id = auth.uid();

  v_email := lower(trim(COALESCE(NULLIF(TRIM(p_contact_email), ''), v_auth_email, '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'A contact email is required';
  END IF;

  v_source_post_id := 'pp:' || gen_random_uuid()::text;

  FOR v_index IN 0 .. v_candidate_count - 1 LOOP
    v_candidate := p_candidates -> v_index;
    v_role_title := TRIM(COALESCE(v_candidate->>'role_title', ''));
    IF v_role_title = '' THEN
      RAISE EXCEPTION 'Candidate % is missing a role title', v_index + 1;
    END IF;
    IF length(v_role_title) > 200 THEN
      RAISE EXCEPTION 'Candidate % role title is too long', v_index + 1;
    END IF;

    SELECT COALESCE(array_agg(value), '{}') INTO v_core_skills
      FROM jsonb_array_elements_text(COALESCE(v_candidate->'core_skills', '[]'::jsonb)) AS value;
    IF array_length(v_core_skills, 1) > 25 THEN
      RAISE EXCEPTION 'Candidate % has too many skills listed', v_index + 1;
    END IF;

    SELECT COALESCE(array_agg(value), '{}') INTO v_locations
      FROM jsonb_array_elements_text(COALESCE(v_candidate->'locations', '[]'::jsonb)) AS value;
    IF array_length(v_locations, 1) > 25 THEN
      RAISE EXCEPTION 'Candidate % has too many locations listed', v_index + 1;
    END IF;

    BEGIN
    INSERT INTO public.social_hotlist (
      source_post_id, candidate_index, platform, posted_at, raw_post_content,
      bench_sales_recruiter_name, bench_sales_recruiter_email, bench_sales_recruiter_phone,
      bench_sales_company_name, candidate_name, role_title, core_skills, years_experience,
      visa_type, employment_type, work_type, locations, hourly_rate_min, hourly_rate_max,
      availability, candidate_summary, classification_confidence, consultant_count, post_scope,
      post_source, created_by_account_id, created_by_user_id, post_status, bench_sales_recruiter_avatar_url
    ) VALUES (
      v_source_post_id,
      v_index,
      'profilepush',
      now(),
      COALESCE(NULLIF(TRIM(p_post_content), ''), NULLIF(TRIM(v_candidate->>'candidate_summary'), ''), v_role_title),
      COALESCE(NULLIF(TRIM(v_display_name), ''), NULLIF(TRIM(v_full_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'),
      v_email,
      TRIM(COALESCE(p_contact_phone, '')),
      (SELECT name FROM public.accounts WHERE id = v_account_id),
      TRIM(COALESCE(v_candidate->>'candidate_name', '')),
      v_role_title,
      v_core_skills,
      NULLIF(v_candidate->>'years_experience', '')::numeric,
      TRIM(COALESCE(v_candidate->>'visa_type', '')),
      TRIM(COALESCE(v_candidate->>'employment_type', '')),
      TRIM(COALESCE(v_candidate->>'work_type', '')),
      v_locations,
      NULLIF(v_candidate->>'hourly_rate_min', '')::numeric,
      NULLIF(v_candidate->>'hourly_rate_max', '')::numeric,
      TRIM(COALESCE(v_candidate->>'availability', '')),
      COALESCE(v_candidate->>'candidate_summary', ''),
      1.0,
      v_candidate_count,
      v_post_scope,
      'user_post',
      v_account_id,
      auth.uid(),
      'open',
      v_avatar_url
    )
    RETURNING id INTO v_new_id;
    EXCEPTION WHEN raise_exception THEN
      -- The free plan's open-post limit (enforce_free_post_limit) stops the
      -- paste here; what was saved so far stays. Anything else still fails.
      IF SQLERRM LIKE 'Free plan:%' THEN
        v_limit_hit := true;
        EXIT;
      END IF;
      RAISE;
    END;

    v_new_ids := array_append(v_new_ids, v_new_id);
  END LOOP;

  IF v_limit_hit AND coalesce(array_length(v_new_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Free plan: up to 3 open consultants or requirements. Close one, or buy credits to add more.'
      USING HINT = 'free_plan_limit';
  END IF;

  RETURN v_new_ids;
END;
$$;
