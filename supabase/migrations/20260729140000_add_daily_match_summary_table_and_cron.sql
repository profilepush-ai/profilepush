-- Migration: Add daily match summaries table and cron job

-- 1. Create table to store daily match summaries
create table if not exists daily_match_summaries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  summary_date date not null,
  profile_id uuid not null,
  candidate_name text not null,
  total_new_matches int not null default 0,
  unreviewed_matches int not null default 0,
  boards_represented text[] default array[]::text[],
  match_sources jsonb default '[]'::jsonb,  -- Array of {board, count}
  created_at timestamp with time zone default now(),
  
  constraint fk_account foreign key (account_id) references accounts(id) on delete cascade,
  constraint fk_profile foreign key (profile_id) references profiles(id) on delete cascade,
  unique(account_id, summary_date, profile_id)
);

-- 2. Create index for efficient querying
create index idx_daily_match_summaries_account_date on daily_match_summaries(account_id, summary_date desc);
create index idx_daily_match_summaries_profile_date on daily_match_summaries(profile_id, summary_date desc);

-- pg_cron is already enabled on this project

-- 3. Create pg_cron job for Daily Match Summary (6 PM IST = 12:30 UTC)
-- Runs after board job matching (10:30 UTC) and social job matching runs throughout the day
select cron.schedule(
  'daily-match-summary-6pm',
  '30 12 * * *',  -- Every day at 12:30 UTC (6 PM IST)
  $$
    select
      net.http_post(
        url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/generate-daily-match-summary',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := jsonb_build_object(
          'action', 'generate_summary'
        )::text
      ) as request_id;
  $$
);

-- IST to UTC Conversion:
-- 6 PM IST = 18:00 IST = 12:30 UTC
