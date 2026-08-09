ALTER TABLE public.social_jobs
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_extracted_details jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.social_jobs
  DROP CONSTRAINT IF EXISTS social_jobs_verification_status_check;

ALTER TABLE public.social_jobs
  ADD CONSTRAINT social_jobs_verification_status_check
  CHECK (verification_status IN ('unverified', 'verified'));

CREATE INDEX IF NOT EXISTS social_jobs_verification_status_idx
  ON public.social_jobs (verification_status, verified_at DESC);

CREATE OR REPLACE FUNCTION public.get_pulse_asked_job_states()
RETURNS TABLE(job_id uuid, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    requests.job_id,
    CASE
      WHEN BOOL_OR(requests.status = 'fulfilled' OR jobs.verification_status = 'verified') THEN 'verified'
      ELSE 'asked'
    END AS state
  FROM public.pulse_ask_ai_requests AS requests
  JOIN public.social_jobs AS jobs ON jobs.id = requests.job_id
  WHERE requests.status IN ('completed', 'fulfilled')
  GROUP BY requests.job_id;
$$;

REVOKE ALL ON FUNCTION public.get_pulse_asked_job_states() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pulse_asked_job_states() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asked_job_has_new_requested_detail(
  p_missing_details jsonb,
  p_old public.social_jobs,
  p_new public.social_jobs
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_detail text;
  v_key text;
BEGIN
  FOR v_detail IN
    SELECT lower(trim(value))
    FROM jsonb_array_elements_text(COALESCE(p_missing_details, '[]'::jsonb))
  LOOP
    v_key := CASE
      WHEN v_detail LIKE '%experience%' OR v_detail = 'exp' THEN 'experience_years'
      WHEN v_detail LIKE '%employment%' THEN 'employment_type'
      WHEN v_detail LIKE '%work type%' THEN 'work_type'
      WHEN v_detail LIKE '%rate%' OR v_detail LIKE '%salary%' OR v_detail LIKE '%hourly%' THEN 'hourly_rate'
      WHEN v_detail LIKE '%visa%' THEN 'visa_types'
      WHEN v_detail LIKE '%location%' THEN 'locations'
      WHEN v_detail LIKE '%skill%' THEN 'skills'
      ELSE NULL
    END;

    IF v_key IS NOT NULL
      AND NOT (COALESCE(p_old.reply_extracted_details, '{}'::jsonb) ? v_key)
      AND (COALESCE(p_new.reply_extracted_details, '{}'::jsonb) ? v_key) THEN
      RETURN true;
    END IF;

    IF v_key = 'experience_years'
      AND p_old.extracted_experience_years IS NULL
      AND p_new.extracted_experience_years IS NOT NULL THEN
      RETURN true;
    END IF;

    IF v_key IN ('employment_type', 'work_type')
      AND NULLIF(trim(p_old.employment_type), '') IS NULL
      AND NULLIF(trim(p_new.employment_type), '') IS NOT NULL THEN
      RETURN true;
    END IF;

    IF v_key = 'hourly_rate'
      AND NULLIF(trim(p_old.salary_range), '') IS NULL
      AND NULLIF(trim(p_new.salary_range), '') IS NOT NULL THEN
      RETURN true;
    END IF;

    IF v_key = 'hourly_rate'
      AND p_old.extracted_hourly_rate_min IS NULL
      AND p_old.extracted_hourly_rate_max IS NULL
      AND (p_new.extracted_hourly_rate_min IS NOT NULL OR p_new.extracted_hourly_rate_max IS NOT NULL) THEN
      RETURN true;
    END IF;

    IF v_key = 'visa_types'
      AND jsonb_array_length(COALESCE(p_old.extracted_visa_types, '[]'::jsonb)) = 0
      AND jsonb_array_length(COALESCE(p_new.extracted_visa_types, '[]'::jsonb)) > 0 THEN
      RETURN true;
    END IF;

    IF v_key = 'locations'
      AND NULLIF(trim(p_old.location), '') IS NULL
      AND NULLIF(trim(p_new.location), '') IS NOT NULL THEN
      RETURN true;
    END IF;

    IF v_key = 'skills'
      AND jsonb_array_length(COALESCE(p_old.extracted_skills, '[]'::jsonb)) = 0
      AND jsonb_array_length(COALESCE(p_new.extracted_skills, '[]'::jsonb)) > 0 THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.asked_job_has_new_requested_detail(jsonb, public.social_jobs, public.social_jobs) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asked_job_has_new_requested_detail(jsonb, public.social_jobs, public.social_jobs) TO service_role;
