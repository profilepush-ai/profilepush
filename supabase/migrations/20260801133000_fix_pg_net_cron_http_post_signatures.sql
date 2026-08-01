-- Migration: Fix pg_net http_post cron signatures and social frequency filter
--
-- Why:
-- 1) net.http_post on this project expects body jsonb, not text.
-- 2) Existing cron definitions were passing body::text, causing runtime failures.
-- 3) Social trigger should filter hourly schedules while still running every 3 hours.
--
-- Prerequisite:
-- Ensure app settings are configured in DB for authenticated function calls:
--   alter database postgres set app.supabase_url = 'your-project-ref.supabase.co';
--   alter database postgres set app.service_role_key = 'your_service_role_key';

-- Recreate board daily trigger with jsonb body
select cron.unschedule('job-watch-trigger-boards-daily');
select cron.schedule(
  'job-watch-trigger-boards-daily',
  '30 10 * * *',
  $$
    select net.http_post(
      url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/job-watch-trigger',
      body := jsonb_build_object('frequency_filter', 'daily'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      timeout_milliseconds := 10000
    );
  $$
);

-- Recreate social trigger with jsonb body and hourly filter
-- Note: the cron schedule remains every 3 hours; this filter selects hourly schedules.
select cron.unschedule('job-watch-trigger-social-3hours');
select cron.schedule(
  'job-watch-trigger-social-3hours',
  '0 */3 * * *',
  $$
    select net.http_post(
      url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/job-watch-trigger',
      body := jsonb_build_object('frequency_filter', 'hourly'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      timeout_milliseconds := 10000
    );
  $$
);

-- Recreate daily summary trigger with jsonb body
select cron.unschedule('daily-match-summary-6pm');
select cron.schedule(
  'daily-match-summary-6pm',
  '30 12 * * *',
  $$
    select net.http_post(
      url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/generate-daily-match-summary',
      body := jsonb_build_object('action', 'generate_summary'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      timeout_milliseconds := 10000
    );
  $$
);

-- Recreate daily notifications trigger with jsonb body
select cron.unschedule('send-daily-match-notifications');
select cron.schedule(
  'send-daily-match-notifications',
  '35 12 * * *',
  $$
    select net.http_post(
      url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/send-daily-match-notification',
      body := jsonb_build_object('action', 'send_notifications'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      timeout_milliseconds := 10000
    );
  $$
);
