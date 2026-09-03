-- Job applications: a recruiter viewing a self-posted job in the Feed can
-- submit one of their bench consultants to it (uploading the consultant's
-- resume). This is cross-account by design — bench-sales recruiters submit
-- candidates to requirements OTHER recruiters posted, same as real
-- bench-sales workflows. The submission triggers (in a later migration/edge
-- function) an AI video screening invite emailed to the candidate.
--
-- Writes are locked down the same way 20260816110000 locked down social_jobs
-- writes: SELECT is RLS-scoped, everything else goes through SECURITY
-- DEFINER RPCs that resolve the caller's account server-side.

CREATE TABLE IF NOT EXISTS public.job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_job_id uuid NOT NULL REFERENCES public.social_jobs(id) ON DELETE CASCADE,
  created_by_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_name text NOT NULL DEFAULT '',
  candidate_email text NOT NULL DEFAULT '',
  candidate_phone text NOT NULL DEFAULT '',
  resume_url text NOT NULL DEFAULT '',
  resume_file_name text NOT NULL DEFAULT '',
  resume_parsed_json jsonb,
  screening_token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'screening_sent', 'screening_completed', 'shortlisted', 'rejected')),
  ai_summary text,
  ai_score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_applications_social_job_id ON public.job_applications (social_job_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_created_by_account_id ON public.job_applications (created_by_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_applications_screening_token ON public.job_applications (screening_token);

CREATE TABLE IF NOT EXISTS public.job_application_screening_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  turn_index integer NOT NULL,
  question_text text NOT NULL,
  video_stream_uid text,
  transcript text,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_job_application_screening_turns_application_id ON public.job_application_screening_turns (application_id);

ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_application_screening_turns ENABLE ROW LEVEL SECURITY;

-- SELECT: the recruiter who submitted the application, OR the recruiter who
-- owns the job post it was submitted to (the one reviewing applicants).
DROP POLICY IF EXISTS select_job_applications ON public.job_applications;
CREATE POLICY select_job_applications
  ON public.job_applications
  FOR SELECT
  TO authenticated
  USING (
    created_by_account_id = public.get_current_account_id()
    OR EXISTS (
      SELECT 1 FROM public.social_jobs sj
      WHERE sj.id = social_job_id AND sj.created_by_account_id = public.get_current_account_id()
    )
  );

DROP POLICY IF EXISTS select_job_application_screening_turns ON public.job_application_screening_turns;
CREATE POLICY select_job_application_screening_turns
  ON public.job_application_screening_turns
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.job_applications ja
      LEFT JOIN public.social_jobs sj ON sj.id = ja.social_job_id
      WHERE ja.id = application_id
        AND (ja.created_by_account_id = public.get_current_account_id()
          OR sj.created_by_account_id = public.get_current_account_id())
    )
  );

-- No direct INSERT/UPDATE/DELETE for authenticated or anon — every write
-- (recruiter submission, screening-worker updates, poster decisions) goes
-- through a SECURITY DEFINER RPC.
REVOKE INSERT, UPDATE, DELETE ON public.job_applications FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.job_application_screening_turns FROM authenticated, anon;
REVOKE ALL ON public.job_applications FROM anon;
REVOKE ALL ON public.job_application_screening_turns FROM anon;


CREATE OR REPLACE FUNCTION public.submit_job_application(
  p_social_job_id uuid,
  p_candidate_name text,
  p_candidate_email text,
  p_candidate_phone text DEFAULT '',
  p_resume_url text DEFAULT '',
  p_resume_file_name text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_job_exists boolean;
  v_new_id uuid;
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
    SELECT 1 FROM public.social_jobs
    WHERE id = p_social_job_id AND hidden_at IS NULL
  ) INTO v_job_exists;
  IF NOT v_job_exists THEN
    RAISE EXCEPTION 'Job post not found';
  END IF;

  IF COALESCE(TRIM(p_candidate_name), '') = '' THEN
    RAISE EXCEPTION 'Candidate name is required';
  END IF;
  IF length(p_candidate_name) > 200 THEN
    RAISE EXCEPTION 'Candidate name is too long';
  END IF;
  IF COALESCE(TRIM(p_candidate_email), '') !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'A valid candidate email is required';
  END IF;
  IF COALESCE(TRIM(p_resume_url), '') = '' THEN
    RAISE EXCEPTION 'A resume upload is required';
  END IF;

  INSERT INTO public.job_applications (
    social_job_id, created_by_account_id, created_by_user_id,
    candidate_name, candidate_email, candidate_phone,
    resume_url, resume_file_name, status
  ) VALUES (
    p_social_job_id, v_account_id, auth.uid(),
    TRIM(p_candidate_name), lower(TRIM(p_candidate_email)), TRIM(COALESCE(p_candidate_phone, '')),
    TRIM(p_resume_url), TRIM(COALESCE(p_resume_file_name, '')), 'submitted'
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_job_application(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_job_application(uuid, text, text, text, text, text) TO authenticated;


-- Poster decision (shortlist/reject) — only the account that owns the job
-- post being applied to may set this.
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
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_status NOT IN ('shortlisted', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT am.account_id INTO v_account_id
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
END;
$$;

REVOKE ALL ON FUNCTION public.set_job_application_decision(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_job_application_decision(uuid, text) TO authenticated;
