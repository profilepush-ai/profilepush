/*
# Add run_status to watch_schedules

1. Modified Tables
  - `watch_schedules`
    - `run_status` (text, default 'idle') — tracks the current run state: idle, scraping, matching, completed, error
    - `current_run_id` (uuid, nullable) — links to the current watch_schedule_runs entry being processed

2. Important Notes
  - This allows the cron trigger to manage multi-step flows (scrape → match → notify)
*/

ALTER TABLE watch_schedules
  ADD COLUMN IF NOT EXISTS run_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS current_run_id uuid REFERENCES watch_schedule_runs(id);
