/*
# Create watch_schedules table

## Summary
Adds a watch_schedules table for the "Job Watch AI" feature. Each schedule
defines an automated, recurring radar scan configuration: which profile to
monitor, which boards to search, how often, and whether it's active.

## New Tables

### watch_schedules
- id (uuid, PK)
- account_id (uuid, FK to accounts) — scoped to the business account
- profile_id (uuid, FK to profiles) — which candidate profile to scan for
- boards (text[]) — which job boards to scan (e.g. linkedin, dice, indeed)
- frequency (text) — how often: 'daily', 'twice_daily', 'weekly'
- is_active (boolean) — whether the schedule is currently enabled
- last_run_at (timestamptz, nullable) — when this schedule last executed
- created_at (timestamptz)
- updated_at (timestamptz)

## Security
- RLS enabled.
- Account-scoped CRUD: users who are members of the account can manage schedules.
*/

CREATE TABLE IF NOT EXISTS watch_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  boards text[] NOT NULL DEFAULT ARRAY['linkedin', 'dice', 'indeed'],
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'twice_daily', 'weekly')),
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE watch_schedules ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_watch_schedules_account ON watch_schedules(account_id);
CREATE INDEX IF NOT EXISTS idx_watch_schedules_profile ON watch_schedules(profile_id);

DROP POLICY IF EXISTS "select_watch_schedules" ON watch_schedules;
CREATE POLICY "select_watch_schedules" ON watch_schedules FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_members
      WHERE account_members.account_id = watch_schedules.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  );

DROP POLICY IF EXISTS "insert_watch_schedules" ON watch_schedules;
CREATE POLICY "insert_watch_schedules" ON watch_schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_members
      WHERE account_members.account_id = watch_schedules.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  );

DROP POLICY IF EXISTS "update_watch_schedules" ON watch_schedules;
CREATE POLICY "update_watch_schedules" ON watch_schedules FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_members
      WHERE account_members.account_id = watch_schedules.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_members
      WHERE account_members.account_id = watch_schedules.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  );

DROP POLICY IF EXISTS "delete_watch_schedules" ON watch_schedules;
CREATE POLICY "delete_watch_schedules" ON watch_schedules FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_members
      WHERE account_members.account_id = watch_schedules.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  );
