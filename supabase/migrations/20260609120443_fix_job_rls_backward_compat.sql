-- Make RLS backward-compatible: allow rows where account_id IS NULL (legacy data)
-- These will be visible to all authenticated users until they're associated with an account

DROP POLICY IF EXISTS "select_account_linkedin_jobs" ON linkedin_jobs;
CREATE POLICY "select_account_linkedin_jobs" ON linkedin_jobs FOR SELECT
  TO authenticated
  USING (
    search_id IN (
      SELECT id FROM linkedin_job_searches
      WHERE account_id = get_current_account_id()
         OR account_id IS NULL
    )
  );

DROP POLICY IF EXISTS "select_account_dice_jobs" ON dice_jobs;
CREATE POLICY "select_account_dice_jobs" ON dice_jobs FOR SELECT
  TO authenticated
  USING (
    search_id IN (
      SELECT id FROM dice_job_searches
      WHERE account_id = get_current_account_id()
         OR account_id IS NULL
    )
  );

DROP POLICY IF EXISTS "select_account_indeed_jobs" ON indeed_jobs;
CREATE POLICY "select_account_indeed_jobs" ON indeed_jobs FOR SELECT
  TO authenticated
  USING (
    search_id IN (
      SELECT id FROM indeed_job_searches
      WHERE account_id = get_current_account_id()
         OR account_id IS NULL
    )
  );
