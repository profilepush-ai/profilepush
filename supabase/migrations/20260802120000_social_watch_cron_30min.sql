-- Change social job matching cron from every 3 hours to every 30 minutes
-- This ensures new social jobs get matched against all active hotlist_ai_roles quickly

select cron.unschedule('job-watch-trigger-social-3hours');
select cron.schedule(
  'job-watch-trigger-social-30min',
  '*/30 * * * *',
  $$
    select net.http_post(
      url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/job-watch-trigger',
      body := jsonb_build_object('frequency_filter', 'hourly', 'force_run', true),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      timeout_milliseconds := 10000
    );
  $$
);
