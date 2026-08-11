-- Forward every in-app notification to the push delivery function.
CREATE OR REPLACE FUNCTION public.push_inserted_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_supabase_host text;
  v_service_role_key text;
BEGIN
  v_supabase_host := current_setting('app.supabase_url', true);
  v_service_role_key := current_setting('app.service_role_key', true);

  IF COALESCE(v_supabase_host, '') = '' OR COALESCE(v_service_role_key, '') = '' THEN
    RAISE WARNING 'Push notification skipped because Supabase database settings are missing';
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://' || v_supabase_host || '/functions/v1/send-push-notification',
      body := jsonb_build_object(
        'id', NEW.id,
        'user_id', NEW.user_id,
        'type', NEW.type,
        'title', NEW.title,
        'body', NEW.body,
        'link', NEW.link
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to queue push for notification %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_send_push ON public.notifications;
CREATE TRIGGER notifications_send_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.push_inserted_notification();

REVOKE ALL ON FUNCTION public.push_inserted_notification() FROM PUBLIC;