-- Migration: Add account-level match summary view and notification cron job

-- 1. Create view for account-level daily match summaries
create or replace view account_daily_match_summaries as
select
  dms.summary_date,
  a.id as account_id,
  a.owner_id,
  u.email as owner_email,
  count(distinct dms.profile_id) as profiles_with_matches,
  sum(dms.total_new_matches) as total_new_matches,
  array_agg(distinct dms.candidate_name) as candidate_names,
  jsonb_agg(
    jsonb_build_object(
      'profile_id', dms.profile_id,
      'candidate_name', dms.candidate_name,
      'match_count', dms.total_new_matches,
      'boards', dms.boards_represented,
      'match_sources', dms.match_sources
    )
  ) as profiles_breakdown,
  (
    select jsonb_object_agg(board, total)
    from (
      select board, sum(count) as total
      from (
        select jsonb_array_elements(dms.match_sources)->>'board' as board,
               (jsonb_array_elements(dms.match_sources)->>'count')::int as count
        from daily_match_summaries dms
        where dms.account_id = a.id
          and dms.summary_date = current_date
      ) boards_count
      group by board
      order by total desc
    ) board_totals
  ) as boards_breakdown,
  max(dms.created_at) as created_at
from daily_match_summaries dms
inner join accounts a on dms.account_id = a.id
inner join auth.users u on a.owner_id = u.id
where dms.summary_date = current_date
group by dms.summary_date, a.id, a.owner_id, u.email;

-- 2. Grant permissions
grant select on account_daily_match_summaries to authenticated;
grant select on account_daily_match_summaries to service_role;

-- pg_cron is already enabled on this project

-- 3. Create pg_cron job for sending daily match notifications (6:05 PM IST = 12:35 UTC)
-- Runs 5 minutes after daily summary is generated to ensure data is ready
select cron.schedule(
  'send-daily-match-notifications',
  '35 12 * * *',  -- Every day at 12:35 UTC (6:05 PM IST)
  $$
    select
      net.http_post(
        url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/send-daily-match-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := jsonb_build_object(
          'action', 'send_notifications'
        )::text
      ) as request_id;
  $$
);

-- IST to UTC Conversion:
-- 6:05 PM IST = 18:05 IST = 12:35 UTC
