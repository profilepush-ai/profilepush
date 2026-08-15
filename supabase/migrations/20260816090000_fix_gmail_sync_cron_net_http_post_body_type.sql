-- The original sync-gmail-conversations cron job (20260815160000) called
-- net.http_post with body := '{}'::text, but this project's pg_net version requires
-- body jsonb — every run since creation failed with "function net.http_post(...)
-- does not exist", so gmail-sync was never actually invoked. Reschedule with the
-- correct jsonb body (cron.schedule replaces an existing job of the same name).

select cron.schedule(
  'sync-gmail-conversations',
  '*/3 * * * *',
  $$
    select
      net.http_post(
        url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/gmail-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := '{}'::jsonb
      ) as request_id;
  $$
);
