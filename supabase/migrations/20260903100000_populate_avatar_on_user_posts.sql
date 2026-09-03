-- Self-submitted job/hotlist posts had no avatar_url at all (that column was
-- only ever populated by the scraped-post pipeline). Since the poster is a
-- signed-in ProfilePush account, their real Google profile photo (when they
-- signed in with Google) is already sitting on auth.users.raw_user_meta_data
-- — capture it into the same avatar_url / bench_sales_recruiter_avatar_url
-- columns the scraper already writes, so the frontend (already reading
-- lead.avatarUrl) needs no changes at all.

CREATE OR REPLACE FUNCTION public.create_user_job_post(
  p_job_title text,
  p_company_name text DEFAULT '',
  p_location text DEFAULT '',
  p_employment_type text DEFAULT '',
  p_seniority_level text DEFAULT '',
  p_salary_range text DEFAULT '',
  p_job_description text DEFAULT '',
  p_post_content text DEFAULT '',
  p_skills text[] DEFAULT '{}',
  p_experience_years integer DEFAULT NULL,
  p_visa_types text[] DEFAULT '{}',
  p_hourly_rate_min numeric DEFAULT NULL,
  p_hourly_rate_max numeric DEFAULT NULL,
  p_contact_email text DEFAULT '',
  p_contact_phone text DEFAULT ''
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
  v_email text;
  v_auth_email text;
  v_avatar_url text;
  v_recent_count integer;
  v_new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
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

  IF COALESCE(TRIM(p_job_title), '') = '' THEN
    RAISE EXCEPTION 'Job title is required';
  END IF;
  IF length(p_job_title) > 200 THEN
    RAISE EXCEPTION 'Job title is too long';
  END IF;
  IF length(COALESCE(p_job_description, '')) > 8000 THEN
    RAISE EXCEPTION 'Job description is too long';
  END IF;
  IF length(COALESCE(p_post_content, '')) > 8000 THEN
    RAISE EXCEPTION 'Post content is too long';
  END IF;
  IF COALESCE(array_length(p_skills, 1), 0) > 25 THEN
    RAISE EXCEPTION 'Too many skills listed';
  END IF;
  IF COALESCE(array_length(p_visa_types, 1), 0) > 25 THEN
    RAISE EXCEPTION 'Too many visa types listed';
  END IF;

  SELECT (
    (SELECT count(*) FROM public.social_jobs WHERE created_by_account_id = v_account_id AND post_source = 'user_post' AND created_at >= now() - interval '24 hours')
    +
    (SELECT count(*) FROM public.social_hotlist WHERE created_by_account_id = v_account_id AND post_source = 'user_post' AND created_at >= now() - interval '24 hours')
  ) INTO v_recent_count;

  IF v_recent_count >= 20 THEN
    RAISE EXCEPTION 'You have reached the daily post limit — try again tomorrow';
  END IF;

  SELECT au.email, COALESCE(NULLIF(au.raw_user_meta_data->>'avatar_url', ''), NULLIF(au.raw_user_meta_data->>'picture', ''), '')
    INTO v_auth_email, v_avatar_url
    FROM auth.users au WHERE au.id = auth.uid();

  v_email := lower(trim(COALESCE(NULLIF(TRIM(p_contact_email), ''), v_auth_email, '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'A contact email is required';
  END IF;

  INSERT INTO public.social_jobs (
    account_id, post_id, platform, posted_by_name, posted_at, poster_email, poster_phone,
    post_content, job_title, company_name, location, employment_type, seniority_level,
    job_description, salary_range, extracted_skills, extracted_experience_years,
    extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max,
    extracted_role_normalized, radar_enriched, verification_status,
    post_source, created_by_account_id, created_by_user_id, post_status, avatar_url
  ) VALUES (
    v_account_id,
    'pp:' || gen_random_uuid()::text,
    'profilepush',
    COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'),
    now(),
    v_email,
    TRIM(COALESCE(p_contact_phone, '')),
    COALESCE(NULLIF(TRIM(p_post_content), ''), NULLIF(TRIM(p_job_description), ''), TRIM(p_job_title)),
    TRIM(p_job_title),
    TRIM(COALESCE(p_company_name, '')),
    TRIM(COALESCE(p_location, '')),
    TRIM(COALESCE(p_employment_type, '')),
    TRIM(COALESCE(p_seniority_level, '')),
    COALESCE(p_job_description, ''),
    TRIM(COALESCE(p_salary_range, '')),
    to_jsonb(COALESCE(p_skills, '{}'::text[])),
    p_experience_years,
    to_jsonb(COALESCE(p_visa_types, '{}'::text[])),
    p_hourly_rate_min,
    p_hourly_rate_max,
    lower(trim(p_job_title)),
    false,
    'unverified',
    'user_post',
    v_account_id,
    auth.uid(),
    'open',
    v_avatar_url
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.create_user_hotlist_post(
  p_role_title text,
  p_candidate_name text DEFAULT '',
  p_core_skills text[] DEFAULT '{}',
  p_years_experience numeric DEFAULT NULL,
  p_visa_type text DEFAULT '',
  p_employment_type text DEFAULT '',
  p_work_type text DEFAULT '',
  p_locations text[] DEFAULT '{}',
  p_hourly_rate_min numeric DEFAULT NULL,
  p_hourly_rate_max numeric DEFAULT NULL,
  p_availability text DEFAULT '',
  p_candidate_summary text DEFAULT '',
  p_post_content text DEFAULT '',
  p_contact_email text DEFAULT '',
  p_contact_phone text DEFAULT ''
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
  v_email text;
  v_auth_email text;
  v_avatar_url text;
  v_recent_count integer;
  v_new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
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

  IF COALESCE(TRIM(p_role_title), '') = '' THEN
    RAISE EXCEPTION 'Role title is required';
  END IF;
  IF length(p_role_title) > 200 THEN
    RAISE EXCEPTION 'Role title is too long';
  END IF;
  IF length(COALESCE(p_candidate_summary, '')) > 8000 THEN
    RAISE EXCEPTION 'Candidate summary is too long';
  END IF;
  IF length(COALESCE(p_post_content, '')) > 8000 THEN
    RAISE EXCEPTION 'Post content is too long';
  END IF;
  IF COALESCE(array_length(p_core_skills, 1), 0) > 25 THEN
    RAISE EXCEPTION 'Too many skills listed';
  END IF;
  IF COALESCE(array_length(p_locations, 1), 0) > 25 THEN
    RAISE EXCEPTION 'Too many locations listed';
  END IF;

  SELECT (
    (SELECT count(*) FROM public.social_jobs WHERE created_by_account_id = v_account_id AND post_source = 'user_post' AND created_at >= now() - interval '24 hours')
    +
    (SELECT count(*) FROM public.social_hotlist WHERE created_by_account_id = v_account_id AND post_source = 'user_post' AND created_at >= now() - interval '24 hours')
  ) INTO v_recent_count;

  IF v_recent_count >= 20 THEN
    RAISE EXCEPTION 'You have reached the daily post limit — try again tomorrow';
  END IF;

  SELECT au.email, COALESCE(NULLIF(au.raw_user_meta_data->>'avatar_url', ''), NULLIF(au.raw_user_meta_data->>'picture', ''), '')
    INTO v_auth_email, v_avatar_url
    FROM auth.users au WHERE au.id = auth.uid();

  v_email := lower(trim(COALESCE(NULLIF(TRIM(p_contact_email), ''), v_auth_email, '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'A contact email is required';
  END IF;

  INSERT INTO public.social_hotlist (
    source_post_id, candidate_index, platform, posted_at, raw_post_content,
    bench_sales_recruiter_name, bench_sales_recruiter_email, bench_sales_recruiter_phone,
    bench_sales_company_name, candidate_name, role_title, core_skills, years_experience,
    visa_type, employment_type, work_type, locations, hourly_rate_min, hourly_rate_max,
    availability, candidate_summary, classification_confidence, consultant_count, post_scope,
    post_source, created_by_account_id, created_by_user_id, post_status, bench_sales_recruiter_avatar_url
  ) VALUES (
    'pp:' || gen_random_uuid()::text,
    0,
    'profilepush',
    now(),
    COALESCE(NULLIF(TRIM(p_post_content), ''), NULLIF(TRIM(p_candidate_summary), ''), TRIM(p_role_title)),
    COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'),
    v_email,
    TRIM(COALESCE(p_contact_phone, '')),
    (SELECT name FROM public.accounts WHERE id = v_account_id),
    TRIM(COALESCE(p_candidate_name, '')),
    TRIM(p_role_title),
    COALESCE(p_core_skills, '{}'::text[]),
    p_years_experience,
    TRIM(COALESCE(p_visa_type, '')),
    TRIM(COALESCE(p_employment_type, '')),
    TRIM(COALESCE(p_work_type, '')),
    COALESCE(p_locations, '{}'::text[]),
    p_hourly_rate_min,
    p_hourly_rate_max,
    TRIM(COALESCE(p_availability, '')),
    COALESCE(p_candidate_summary, ''),
    1.0,
    1,
    'single',
    'user_post',
    v_account_id,
    auth.uid(),
    'open',
    v_avatar_url
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;


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

  SELECT au.email, COALESCE(NULLIF(au.raw_user_meta_data->>'avatar_url', ''), NULLIF(au.raw_user_meta_data->>'picture', ''), '')
    INTO v_auth_email, v_avatar_url
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
      COALESCE(NULLIF(TRIM(v_display_name), ''), split_part(v_invited_email, '@', 1), 'ProfilePush user'),
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

    v_new_ids := array_append(v_new_ids, v_new_id);
  END LOOP;

  RETURN v_new_ids;
END;
$$;

-- Backfill existing user-submitted posts with their poster's current avatar
-- (best-effort; a poster who has since deleted their account leaves these
-- rows at '', same as they were before this migration).
UPDATE public.social_jobs sj
SET avatar_url = COALESCE(NULLIF(au.raw_user_meta_data->>'avatar_url', ''), NULLIF(au.raw_user_meta_data->>'picture', ''), '')
FROM auth.users au
WHERE sj.post_source = 'user_post' AND sj.created_by_user_id = au.id AND sj.avatar_url = '';

UPDATE public.social_hotlist sh
SET bench_sales_recruiter_avatar_url = COALESCE(NULLIF(au.raw_user_meta_data->>'avatar_url', ''), NULLIF(au.raw_user_meta_data->>'picture', ''), '')
FROM auth.users au
WHERE sh.post_source = 'user_post' AND sh.created_by_user_id = au.id AND sh.bench_sales_recruiter_avatar_url = '';
