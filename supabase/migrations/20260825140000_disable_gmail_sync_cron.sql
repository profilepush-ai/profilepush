-- gmail.readonly was dropped from the Gmail OAuth scope request (Google Cloud
-- console + supabase/functions/_shared/gmail.ts, both 2026-08-25) to speed up
-- OAuth verification. gmail-sync (polls vendor reply threads every 3 minutes,
-- supabase/migrations/20260815160000_schedule_gmail_sync_cron.sql) requires
-- that scope for every call it makes and is now disabled at the function
-- level too (its own early-return guard) — unschedule the cron so it stops
-- firing every 3 minutes against a function that only ever returns
-- {disabled: true} now. Re-add via cron.schedule with the same name/schedule
-- if gmail.readonly is ever requested and approved again.
select cron.unschedule('sync-gmail-conversations');
