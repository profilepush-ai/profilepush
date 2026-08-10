-- Vendor replies were previously mislabeled as asked-job update notifications.
UPDATE public.notifications
SET type = 'vendor_reply_received'
WHERE type = 'asked_job_updated'
  AND link LIKE '/inbox/%';

-- Job-detail fulfillment remains active, but it no longer creates an in-app notification.
DELETE FROM public.notifications
WHERE type = 'asked_job_updated';

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