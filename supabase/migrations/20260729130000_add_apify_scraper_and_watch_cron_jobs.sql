-- Migration: Add pg_cron jobs for job watch trigger (matching only)
-- NOTE: Apify scraper scheduler is configured directly in Apify (outside this database)

-- pg_cron is already enabled on this project

-- 2. Create pg_cron job for Job Watch Trigger - Board Jobs (Daily at 4 PM IST = 10:30 UTC)
-- Runs all active daily-frequency schedules for board jobs (linkedin, dice, indeed, monster, careerbuilder)
-- Uses pgvector semantic search + Gemini LLM scoring
select cron.schedule(
  'job-watch-trigger-boards-daily',
  '30 10 * * *',  -- Every day at 10:30 UTC (4 PM IST)
  $$
    select
      net.http_post(
        url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/job-watch-trigger',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := jsonb_build_object(
          'frequency_filter', 'daily'
        )::text
      ) as request_id;
  $$
);

-- 3. Create pg_cron job for Job Watch Trigger - Social Jobs (Every 3 hours)
-- Runs at: 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 UTC
-- Social jobs run every 3 hours to catch frequent posts from social platforms
-- Uses pgvector semantic search + Gemini LLM scoring
select cron.schedule(
  'job-watch-trigger-social-3hours',
  '0 */3 * * *',  -- Every 3 hours
  $$
    select
      net.http_post(
        url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/job-watch-trigger',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := jsonb_build_object(
          'frequency_filter', '3_hours'
        )::text
      ) as request_id;
  $$
);

-- IST to UTC Conversion Reference:
-- IST = UTC + 5:30
-- 4 PM IST = 16:00 IST = 10:30 UTC
-- Every 3 hours UTC = 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 UTC
