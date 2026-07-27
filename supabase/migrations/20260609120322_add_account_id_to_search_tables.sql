-- Add account_id to all 3 search tables so history can be scoped per account

ALTER TABLE linkedin_job_searches ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE dice_job_searches     ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE indeed_job_searches   ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_linkedin_searches_account ON linkedin_job_searches (account_id);
CREATE INDEX IF NOT EXISTS idx_dice_searches_account     ON dice_job_searches     (account_id);
CREATE INDEX IF NOT EXISTS idx_indeed_searches_account   ON indeed_job_searches   (account_id);

-- Update RLS on job tables to scope selects by account via the search record
-- LinkedIn
DROP POLICY IF EXISTS "anon_select_linkedin_jobs" ON linkedin_jobs;
CREATE POLICY "select_account_linkedin_jobs" ON linkedin_jobs FOR SELECT
  TO authenticated
  USING (
    search_id IN (
      SELECT id FROM linkedin_job_searches
      WHERE account_id = get_current_account_id()
    )
  );

-- Dice
DROP POLICY IF EXISTS "select_dice_jobs" ON dice_jobs;
CREATE POLICY "select_account_dice_jobs" ON dice_jobs FOR SELECT
  TO authenticated
  USING (
    search_id IN (
      SELECT id FROM dice_job_searches
      WHERE account_id = get_current_account_id()
    )
  );

-- Indeed
DROP POLICY IF EXISTS "select_indeed_jobs" ON indeed_jobs;
CREATE POLICY "select_account_indeed_jobs" ON indeed_jobs FOR SELECT
  TO authenticated
  USING (
    search_id IN (
      SELECT id FROM indeed_job_searches
      WHERE account_id = get_current_account_id()
    )
  );
