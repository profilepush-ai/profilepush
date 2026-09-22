-- Tell an invitation apart from an application.
--
-- Both are job_applications rows against the same job, so the Applicants
-- column has been showing them mixed together: a consultant a vendor invited
-- to a screening looks identical to a candidate a bench sales recruiter
-- submitted. They need different handling — one is outbound, the other
-- inbound — and the vendor needs to see how many of each a job has.
--
-- Status is not a safe discriminator. An invite starts at screening_sent, but
-- so does an applicant the moment the vendor sends them a screening, so the
-- two converge. Who created the row does not converge: an invitation is
-- created by the account that owns the job, an application never is.

-- Adding a column changes the return type, which Postgres will not do in
-- place, so the old signature is dropped first. Callers pass the same single
-- argument either way.
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
  applied_by_user_email text,
  is_invite boolean
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

  SELECT EXISTS (
    SELECT 1 FROM public.social_jobs sj
    WHERE sj.id = p_social_job_id AND sj.created_by_account_id = v_account_id
  ) INTO v_owns_job;

  IF NOT v_owns_job THEN
    RAISE EXCEPTION 'Not found';
  END IF;

  RETURN QUERY
  SELECT
    ja.id, ja.candidate_name, ja.candidate_email, ja.candidate_phone,
    ja.resume_url, ja.resume_file_name, ja.recruiter_note, ja.status, ja.ai_summary, ja.ai_score,
    ja.created_at,
    a.name,
    u.email::text,
    (ja.created_by_account_id = v_account_id) AS is_invite
  FROM public.job_applications ja
  LEFT JOIN public.accounts a ON a.id = ja.created_by_account_id
  LEFT JOIN auth.users u ON u.id = ja.created_by_user_id
  WHERE ja.social_job_id = p_social_job_id
  ORDER BY ja.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_post_applications(uuid) TO authenticated;
