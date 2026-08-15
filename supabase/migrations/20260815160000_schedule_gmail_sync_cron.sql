-- Polls Gmail for replies on active gmail-channel conversations, scoped to only the
-- specific threads we created (never a user's full inbox). Every 3 minutes keeps
-- Gmail API quota usage trivial (~20 units per thread checked, vs. 250 units/sec cap)
-- while still feeling reasonably close to real time for v1 polling-based sync.

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
        body := '{}'::text
      ) as request_id;
  $$
);
