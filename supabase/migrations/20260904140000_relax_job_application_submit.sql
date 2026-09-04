-- The Apply modal no longer asks the recruiter for candidate name/email/phone
-- (those come from resume parsing instead, best-effort — a resume doesn't
-- always yield a clean name/email). Relaxes submit_job_application to accept
-- empty/best-effort values rather than requiring them, adds an optional
-- recruiter note, and lets the caller pass already-parsed resume JSON
-- (parsed client-side before this call) so process-job-application doesn't
-- need to parse the resume a second time.

ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS recruiter_note text NOT NULL DEFAULT '';

DROP FUNCTION IF EXISTS public.submit_job_application(uuid, text, text, text, text, text);

CREATE FUNCTION public.submit_job_application(
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

  -- Best-effort, resume-derived — silently drop rather than reject the
  -- application if the parser produced something too long or malformed.
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
  SELECT v_new_id, ja.screening_token FROM public.job_applications ja WHERE ja.id = v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_job_application(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_job_application(uuid, text, text, text, text, text, text, jsonb) TO authenticated;


-- Surface the recruiter's note on the Applications page too.
DROP FUNCTION IF EXISTS public.get_post_applications(uuid);

CREATE FUNCTION public.get_post_applications(p_social_job_id uuid)
RETURNS TABLE (
  id uuid,
  candidate_name text,
  candidate_email text,
  candidate_phone text,
  resume_url text,
  resume_file_name text,
  recruiter_note text,
  status text,
  ai_summary text,
  ai_score numeric,
  created_at timestamptz,
  applied_by_account_name text,
  applied_by_user_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_owns_job boolean;
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
    WHERE sj.id = p_social_job_id AND sj.created_by_account_id = v_account_id
  ) INTO v_owns_job;

  IF NOT v_owns_job THEN
    RAISE EXCEPTION 'Job post not found';
  END IF;

  RETURN QUERY
  SELECT
    ja.id, ja.candidate_name, ja.candidate_email, ja.candidate_phone,
    ja.resume_url, ja.resume_file_name, ja.recruiter_note, ja.status, ja.ai_summary, ja.ai_score,
    ja.created_at,
    a.name,
    u.email::text
  FROM public.job_applications ja
  LEFT JOIN public.accounts a ON a.id = ja.created_by_account_id
  LEFT JOIN auth.users u ON u.id = ja.created_by_user_id
  WHERE ja.social_job_id = p_social_job_id
  ORDER BY ja.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_post_applications(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_post_applications(uuid) TO authenticated;
