/*
# Account-scoped data isolation

## Summary
Adds per-account data isolation so each workspace only sees its own profiles,
resume files, wishlisted jobs, and activity logs. Replaces the original
wide-open policies (USING true, TO anon) with authenticated-only, account-scoped
policies.

## Changes

### New helper function
- `get_current_account_id()` — SECURITY DEFINER function that returns the
  account_id for the currently authenticated user (looks up account_members).
  Used in column DEFAULTs and RLS USING clauses so every query is automatically
  scoped to the caller's workspace without extra client-side wiring.

### profiles table
- New column `account_id uuid` (nullable FK → accounts, ON DELETE SET NULL).
- Column DEFAULT set to `get_current_account_id()` so inserts that omit
  account_id are automatically attributed to the inserting user's workspace.
- Old permissive anon policies dropped.
- New authenticated-only policies: SELECT/INSERT/UPDATE/DELETE scoped to rows
  where `account_id = get_current_account_id()`.

### resume_files table
- Old permissive policies dropped.
- New policies scope access via the parent profile's account_id
  (EXISTS subquery through profiles).

### wishlisted_jobs table
- Old permissive policies dropped.
- New policies scope access via the parent profile's account_id.

### activity_logs table
- Old permissive policies dropped.
- New policies scope access via the parent profile's account_id.

### job_match_scores table
- Old permissive policies dropped (if they exist).
- New policies scope access via the parent profile's account_id.

## Security notes
- `get_current_account_id()` is SECURITY DEFINER / STABLE so it executes as the
  postgres role but reads only the calling user's membership row via auth.uid().
- Existing rows with account_id = NULL become invisible to all users. This is
  intentional — orphaned rows from before multi-tenancy was added are effectively
  sandboxed until migrated.
*/

-- ── Helper function ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_current_account_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT account_id
  FROM account_members
  WHERE user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

-- ── profiles ───────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE profiles
  ALTER COLUMN account_id SET DEFAULT get_current_account_id();

-- Drop old wide-open policies
DROP POLICY IF EXISTS "anon_select_profiles" ON profiles;
DROP POLICY IF EXISTS "anon_insert_profiles" ON profiles;
DROP POLICY IF EXISTS "anon_update_profiles" ON profiles;
DROP POLICY IF EXISTS "anon_delete_profiles" ON profiles;

-- New account-scoped policies
DROP POLICY IF EXISTS "select_account_profiles" ON profiles;
CREATE POLICY "select_account_profiles" ON profiles FOR SELECT
  TO authenticated
  USING (account_id = get_current_account_id());

DROP POLICY IF EXISTS "insert_account_profiles" ON profiles;
CREATE POLICY "insert_account_profiles" ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (account_id = get_current_account_id());

DROP POLICY IF EXISTS "update_account_profiles" ON profiles;
CREATE POLICY "update_account_profiles" ON profiles FOR UPDATE
  TO authenticated
  USING (account_id = get_current_account_id())
  WITH CHECK (account_id = get_current_account_id());

DROP POLICY IF EXISTS "delete_account_profiles" ON profiles;
CREATE POLICY "delete_account_profiles" ON profiles FOR DELETE
  TO authenticated
  USING (account_id = get_current_account_id());

-- ── resume_files ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "anon_select_resume_files" ON resume_files;
DROP POLICY IF EXISTS "anon_insert_resume_files" ON resume_files;
DROP POLICY IF EXISTS "anon_update_resume_files" ON resume_files;
DROP POLICY IF EXISTS "anon_delete_resume_files" ON resume_files;

DROP POLICY IF EXISTS "select_account_resume_files" ON resume_files;
CREATE POLICY "select_account_resume_files" ON resume_files FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "insert_account_resume_files" ON resume_files;
CREATE POLICY "insert_account_resume_files" ON resume_files FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "update_account_resume_files" ON resume_files;
CREATE POLICY "update_account_resume_files" ON resume_files FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "delete_account_resume_files" ON resume_files;
CREATE POLICY "delete_account_resume_files" ON resume_files FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

-- ── wishlisted_jobs ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "anon_select_wishlisted_jobs" ON wishlisted_jobs;
DROP POLICY IF EXISTS "anon_insert_wishlisted_jobs" ON wishlisted_jobs;
DROP POLICY IF EXISTS "anon_update_wishlisted_jobs" ON wishlisted_jobs;
DROP POLICY IF EXISTS "anon_delete_wishlisted_jobs" ON wishlisted_jobs;

DROP POLICY IF EXISTS "select_account_wishlisted_jobs" ON wishlisted_jobs;
CREATE POLICY "select_account_wishlisted_jobs" ON wishlisted_jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "insert_account_wishlisted_jobs" ON wishlisted_jobs;
CREATE POLICY "insert_account_wishlisted_jobs" ON wishlisted_jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "update_account_wishlisted_jobs" ON wishlisted_jobs;
CREATE POLICY "update_account_wishlisted_jobs" ON wishlisted_jobs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "delete_account_wishlisted_jobs" ON wishlisted_jobs;
CREATE POLICY "delete_account_wishlisted_jobs" ON wishlisted_jobs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

-- ── activity_logs ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "anon_select_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "anon_insert_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "anon_update_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "anon_delete_activity_logs" ON activity_logs;

DROP POLICY IF EXISTS "select_account_activity_logs" ON activity_logs;
CREATE POLICY "select_account_activity_logs" ON activity_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "insert_account_activity_logs" ON activity_logs;
CREATE POLICY "insert_account_activity_logs" ON activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "update_account_activity_logs" ON activity_logs;
CREATE POLICY "update_account_activity_logs" ON activity_logs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "delete_account_activity_logs" ON activity_logs;
CREATE POLICY "delete_account_activity_logs" ON activity_logs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

-- ── job_match_scores ───────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_match_scores') THEN
    DROP POLICY IF EXISTS "anon_select_job_match_scores" ON job_match_scores;
    DROP POLICY IF EXISTS "anon_insert_job_match_scores" ON job_match_scores;
    DROP POLICY IF EXISTS "anon_update_job_match_scores" ON job_match_scores;
    DROP POLICY IF EXISTS "anon_delete_job_match_scores" ON job_match_scores;
  END IF;
END $$;

DROP POLICY IF EXISTS "select_account_job_match_scores" ON job_match_scores;
CREATE POLICY "select_account_job_match_scores" ON job_match_scores FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "insert_account_job_match_scores" ON job_match_scores;
CREATE POLICY "insert_account_job_match_scores" ON job_match_scores FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "update_account_job_match_scores" ON job_match_scores;
CREATE POLICY "update_account_job_match_scores" ON job_match_scores FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );

DROP POLICY IF EXISTS "delete_account_job_match_scores" ON job_match_scores;
CREATE POLICY "delete_account_job_match_scores" ON job_match_scores FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = profile_id
        AND profiles.account_id = get_current_account_id()
    )
  );
