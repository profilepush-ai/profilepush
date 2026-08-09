ALTER TABLE public.pulse_ask_ai_requests
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfillment_webhook_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfillment_webhook_error text;

ALTER TABLE public.pulse_ask_ai_requests
  DROP CONSTRAINT IF EXISTS pulse_ask_ai_requests_status_check;

ALTER TABLE public.pulse_ask_ai_requests
  ADD CONSTRAINT pulse_ask_ai_requests_status_check
  CHECK (status IN ('processing', 'charged', 'completed', 'fulfilled', 'failed', 'refunded'));

CREATE INDEX IF NOT EXISTS pulse_ask_ai_requests_user_created_idx
  ON public.pulse_ask_ai_requests (user_id, created_at DESC);

GRANT SELECT ON public.pulse_ask_ai_requests TO authenticated;

DROP POLICY IF EXISTS "select_own_pulse_ask_ai_requests" ON public.pulse_ask_ai_requests;
CREATE POLICY "select_own_pulse_ask_ai_requests"
  ON public.pulse_ask_ai_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

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
  IF OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NEW;
  END IF;

  FOR v_request IN
    UPDATE public.pulse_ask_ai_requests
    SET status = 'fulfilled',
        fulfilled_at = now(),
        updated_at = now(),
        fulfillment_webhook_error = NULL
    WHERE job_id = NEW.id
      AND status = 'completed'
      AND fulfilled_at IS NULL
    RETURNING *
  LOOP
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

DROP TRIGGER IF EXISTS fulfill_asked_jobs_on_social_job_update ON public.social_jobs;
CREATE TRIGGER fulfill_asked_jobs_on_social_job_update
  AFTER UPDATE ON public.social_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.fulfill_asked_jobs_after_social_job_update();

REVOKE ALL ON FUNCTION public.fulfill_asked_jobs_after_social_job_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_asked_jobs_after_social_job_update() TO service_role;