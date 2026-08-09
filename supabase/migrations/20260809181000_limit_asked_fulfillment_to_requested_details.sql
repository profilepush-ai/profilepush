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
BEGIN
  FOR v_detail IN
    SELECT lower(trim(value))
    FROM jsonb_array_elements_text(COALESCE(p_missing_details, '[]'::jsonb))
  LOOP
    IF (v_detail LIKE '%experience%' OR v_detail = 'exp')
      AND p_old.extracted_experience_years IS NULL
      AND p_new.extracted_experience_years IS NOT NULL THEN
      RETURN true;
    END IF;

    IF v_detail LIKE '%employment%'
      AND NULLIF(trim(p_old.employment_type), '') IS NULL
      AND NULLIF(trim(p_new.employment_type), '') IS NOT NULL THEN
      RETURN true;
    END IF;

    IF v_detail LIKE '%work type%'
      AND NULLIF(trim(p_old.employment_type), '') IS NULL
      AND NULLIF(trim(p_new.employment_type), '') IS NOT NULL THEN
      RETURN true;
    END IF;

    IF (v_detail LIKE '%rate%' OR v_detail LIKE '%salary%' OR v_detail LIKE '%hourly%')
      AND NULLIF(trim(p_old.salary_range), '') IS NULL
      AND NULLIF(trim(p_new.salary_range), '') IS NOT NULL THEN
      RETURN true;
    END IF;

    IF (v_detail LIKE '%rate%' OR v_detail LIKE '%salary%' OR v_detail LIKE '%hourly%')
      AND p_old.extracted_hourly_rate_min IS NULL
      AND p_old.extracted_hourly_rate_max IS NULL
      AND (p_new.extracted_hourly_rate_min IS NOT NULL OR p_new.extracted_hourly_rate_max IS NOT NULL) THEN
      RETURN true;
    END IF;

    IF v_detail LIKE '%visa%'
      AND jsonb_array_length(COALESCE(p_old.extracted_visa_types, '[]'::jsonb)) = 0
      AND jsonb_array_length(COALESCE(p_new.extracted_visa_types, '[]'::jsonb)) > 0 THEN
      RETURN true;
    END IF;

    IF v_detail LIKE '%location%'
      AND NULLIF(trim(p_old.location), '') IS NULL
      AND NULLIF(trim(p_new.location), '') IS NOT NULL THEN
      RETURN true;
    END IF;

    IF v_detail LIKE '%skill%'
      AND jsonb_array_length(COALESCE(p_old.extracted_skills, '[]'::jsonb)) = 0
      AND jsonb_array_length(COALESCE(p_new.extracted_skills, '[]'::jsonb)) > 0 THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.fulfill_asked_jobs_after_social_job_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_request public.pulse_ask_ai_requests%ROWTYPE;
  v_function_url text;
  v_service_role_key text;
BEGIN
  FOR v_request IN
    SELECT *
    FROM public.pulse_ask_ai_requests
    WHERE job_id = NEW.id
      AND status = 'completed'
      AND fulfilled_at IS NULL
  LOOP
    IF NOT public.asked_job_has_new_requested_detail(v_request.missing_details, OLD, NEW) THEN
      CONTINUE;
    END IF;

    UPDATE public.pulse_ask_ai_requests
    SET status = 'fulfilled',
        fulfilled_at = now(),
        updated_at = now(),
        fulfillment_webhook_error = NULL
    WHERE request_id = v_request.request_id
      AND status = 'completed'
      AND fulfilled_at IS NULL
    RETURNING * INTO v_request;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (account_id, user_id, type, title, body, link)
    VALUES (
      v_request.account_id,
      v_request.user_id,
      'asked_job_updated',
      'Your asked job was updated',
      CONCAT('New details are available for ', COALESCE(NULLIF(NEW.job_title, ''), 'a job you asked about'), '.'),
      '/jobs'
    );

    BEGIN
      v_function_url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/notify-asked-job-updated';
      v_service_role_key := current_setting('app.service_role_key');

      PERFORM net.http_post(
        url := v_function_url,
        body := jsonb_build_object('request_id', v_request.request_id),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_role_key
        ),
        timeout_milliseconds := 10000
      );

      UPDATE public.pulse_ask_ai_requests
      SET fulfillment_webhook_queued_at = now()
      WHERE request_id = v_request.request_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.pulse_ask_ai_requests
      SET fulfillment_webhook_error = LEFT(SQLERRM, 1000)
      WHERE request_id = v_request.request_id;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.asked_job_has_new_requested_detail(jsonb, public.social_jobs, public.social_jobs) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asked_job_has_new_requested_detail(jsonb, public.social_jobs, public.social_jobs) TO service_role;
