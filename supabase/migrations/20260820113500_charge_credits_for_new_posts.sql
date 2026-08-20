-- Creating a job/hotlist post now costs 1 credit. Charged inside the same
-- transaction as the insert (after the existing daily rate-limit check,
-- before the write) so a failed charge and a failed insert both roll back
-- together atomically — no app-level refund needed here, unlike the two
-- edge functions (ask-ai-vendor-email, generate-chat-message) which span an
-- external HTTP call and can't get that for free. auth.uid() inside the
-- nested consume_feature_credit() call correctly resolves to the original
-- caller regardless of SECURITY DEFINER nesting depth.
--
-- update_user_job_post/update_user_hotlist_post are untouched — editing an
-- existing post stays free.
--
-- The 'INSUFFICIENT_CREDITS: ' message prefix lets the frontend distinguish
-- this failure from the function's other RAISE EXCEPTIONs (rate limit,
-- missing title, etc.) via a simple string check, since this file has no
-- SQLSTATE-based error taxonomy today.

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
  v_recent_count integer;
  v_new_id uuid;
  v_credit_result record;
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

  SELECT * INTO v_credit_result FROM public.consume_feature_credit(v_account_id, 1, 'create_post', jsonb_build_object('post_type', 'job'));
  IF NOT v_credit_result.success THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS: %', COALESCE(v_credit_result.message, 'Insufficient credits to create a post');
  END IF;

  v_email := lower(trim(COALESCE(NULLIF(TRIM(p_contact_email), ''), (SELECT email FROM auth.users WHERE id = auth.uid()), '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'A contact email is required';
  END IF;

  INSERT INTO public.social_jobs (
    account_id, post_id, platform, posted_by_name, posted_at, poster_email, poster_phone,
    post_content, job_title, company_name, location, employment_type, seniority_level,
    job_description, salary_range, extracted_skills, extracted_experience_years,
    extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max,
    extracted_role_normalized, radar_enriched, verification_status,
    post_source, created_by_account_id, created_by_user_id, post_status
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
    'open'
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_user_job_post(text, text, text, text, text, text, text, text, text[], integer, text[], numeric, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_user_job_post(text, text, text, text, text, text, text, text, text[], integer, text[], numeric, numeric, text, text) TO authenticated;


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
  v_recent_count integer;
  v_new_id uuid;
  v_credit_result record;
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

  SELECT * INTO v_credit_result FROM public.consume_feature_credit(v_account_id, 1, 'create_post', jsonb_build_object('post_type', 'hotlist'));
  IF NOT v_credit_result.success THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS: %', COALESCE(v_credit_result.message, 'Insufficient credits to create a post');
  END IF;

  v_email := lower(trim(COALESCE(NULLIF(TRIM(p_contact_email), ''), (SELECT email FROM auth.users WHERE id = auth.uid()), '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'A contact email is required';
  END IF;

  INSERT INTO public.social_hotlist (
    source_post_id, candidate_index, platform, posted_at, raw_post_content,
    bench_sales_recruiter_name, bench_sales_recruiter_email, bench_sales_recruiter_phone,
    bench_sales_company_name, candidate_name, role_title, core_skills, years_experience,
    visa_type, employment_type, work_type, locations, hourly_rate_min, hourly_rate_max,
    availability, candidate_summary, classification_confidence, consultant_count, post_scope,
    post_source, created_by_account_id, created_by_user_id, post_status
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
    'open'
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_user_hotlist_post(text, text, text[], numeric, text, text, text, text[], numeric, numeric, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_user_hotlist_post(text, text, text[], numeric, text, text, text, text[], numeric, numeric, text, text, text, text, text) TO authenticated;
