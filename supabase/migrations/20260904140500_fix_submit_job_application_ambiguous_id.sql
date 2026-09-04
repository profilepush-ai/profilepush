-- Fixes an ambiguous column reference introduced by 20260904140000: once
-- submit_job_application's RETURNS TABLE declared an `id` OUT parameter,
-- the pre-existing bare `WHERE id = p_social_job_id` inside the function
-- body became ambiguous against that OUT parameter (caught at call time,
-- not at CREATE time, since plpgsql doesn't fully validate function bodies
-- until first execution).

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
  v_job_exists boolean;
  v_new_id uuid;
  v_email text;
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

  SELECT EXISTS(
    SELECT 1 FROM public.social_jobs sj
    WHERE sj.id = p_social_job_id AND sj.hidden_at IS NULL
  ) INTO v_job_exists;
  IF NOT v_job_exists THEN
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
  RETURNING public.job_applications.id INTO v_new_id;

  RETURN QUERY
  SELECT ja.id, ja.screening_token FROM public.job_applications ja WHERE ja.id = v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_job_application(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_job_application(uuid, text, text, text, text, text, text, jsonb) TO authenticated;
