-- dice_job_searches
CREATE TABLE IF NOT EXISTS dice_job_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  posted_date text NOT NULL DEFAULT '24h',
  status text NOT NULL DEFAULT 'running',
  total_jobs int DEFAULT 0,
  apify_run_id text,
  compute_units numeric,
  cost_usd numeric,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE dice_job_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_dice_job_searches" ON dice_job_searches;
DROP POLICY IF EXISTS "insert_dice_job_searches" ON dice_job_searches;
DROP POLICY IF EXISTS "update_dice_job_searches" ON dice_job_searches;
DROP POLICY IF EXISTS "delete_dice_job_searches" ON dice_job_searches;

CREATE POLICY "select_dice_job_searches" ON dice_job_searches FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_dice_job_searches" ON dice_job_searches FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_dice_job_searches" ON dice_job_searches FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_dice_job_searches" ON dice_job_searches FOR DELETE TO anon, authenticated USING (true);

-- dice_jobs
CREATE TABLE IF NOT EXISTS dice_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES dice_job_searches(id) ON DELETE CASCADE,
  dice_id text,
  job_url text,
  job_title text,
  company_name text,
  company_url text,
  company_logo_url text,
  location text,
  salary_range text,
  employment_type text,
  work_setting text,
  easy_apply boolean DEFAULT false,
  time_posted text,
  job_description text,
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dice_jobs_search_id_idx ON dice_jobs(search_id);

ALTER TABLE dice_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_dice_jobs" ON dice_jobs;
DROP POLICY IF EXISTS "insert_dice_jobs" ON dice_jobs;
DROP POLICY IF EXISTS "update_dice_jobs" ON dice_jobs;
DROP POLICY IF EXISTS "delete_dice_jobs" ON dice_jobs;

CREATE POLICY "select_dice_jobs" ON dice_jobs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_dice_jobs" ON dice_jobs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_dice_jobs" ON dice_jobs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_dice_jobs" ON dice_jobs FOR DELETE TO anon, authenticated USING (true);

-- Extend job_match_scores to support Dice jobs
ALTER TABLE job_match_scores ALTER COLUMN linkedin_job_id DROP NOT NULL;
ALTER TABLE job_match_scores ADD COLUMN IF NOT EXISTS dice_job_id uuid REFERENCES dice_jobs(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS job_match_scores_profile_dice_uidx;
CREATE UNIQUE INDEX job_match_scores_profile_dice_uidx
  ON job_match_scores(profile_id, dice_job_id)
  WHERE dice_job_id IS NOT NULL;
