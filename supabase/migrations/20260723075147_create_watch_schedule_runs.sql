/*
# Create watch_schedule_runs table for execution history

## Summary
Adds a watch_schedule_runs table to track every execution of a watch schedule.
Each run records how many jobs were fetched from boards, how many matched the
profile criteria, the status (success/failed/partial), and timing info. This
powers the "History" tab in the Job Match AI page.

## New Tables

### watch_schedule_runs
- id (uuid, PK)
- schedule_id (uuid, FK to watch_schedules) — which schedule was executed
- account_id (uuid, FK to accounts) — denormalized for efficient RLS
- status (text) — 'success', 'failed', 'partial'
- jobs_fetched (integer) — total jobs scraped from boards
- jobs_matched (integer) — jobs that met the match threshold
- boards_searched (text[]) — which boards were actually queried
- duration_ms (integer) — how long the run took in milliseconds
- error_message (text, nullable) — error details if status is 'failed'
- started_at (timestamptz) — when the run began
- completed_at (timestamptz) — when the run finished
- created_at (timestamptz)

## Security
- RLS enabled.
- Account-scoped read/write for active account members.
*/

CREATE TABLE IF NOT EXISTS watch_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES watch_schedules(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'partial')),
  jobs_fetched integer NOT NULL DEFAULT 0,
  jobs_matched integer NOT NULL DEFAULT 0,
  boards_searched text[] NOT NULL DEFAULT '{}',
  duration_ms integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE watch_schedule_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_watch_schedule_runs_schedule ON watch_schedule_runs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_watch_schedule_runs_account ON watch_schedule_runs(account_id);
CREATE INDEX IF NOT EXISTS idx_watch_schedule_runs_started ON watch_schedule_runs(started_at DESC);

DROP POLICY IF EXISTS "select_watch_schedule_runs" ON watch_schedule_runs;
CREATE POLICY "select_watch_schedule_runs" ON watch_schedule_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_members
      WHERE account_members.account_id = watch_schedule_runs.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  );

DROP POLICY IF EXISTS "insert_watch_schedule_runs" ON watch_schedule_runs;
CREATE POLICY "insert_watch_schedule_runs" ON watch_schedule_runs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_members
      WHERE account_members.account_id = watch_schedule_runs.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  );

DROP POLICY IF EXISTS "update_watch_schedule_runs" ON watch_schedule_runs;
CREATE POLICY "update_watch_schedule_runs" ON watch_schedule_runs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_members
      WHERE account_members.account_id = watch_schedule_runs.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_members
      WHERE account_members.account_id = watch_schedule_runs.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  );

DROP POLICY IF EXISTS "delete_watch_schedule_runs" ON watch_schedule_runs;
CREATE POLICY "delete_watch_schedule_runs" ON watch_schedule_runs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_members
      WHERE account_members.account_id = watch_schedule_runs.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  );
