-- indeed_job_searches
CREATE TABLE IF NOT EXISTS indeed_job_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  date_posted text NOT NULL DEFAULT 'last24Hours',
  status text NOT NULL DEFAULT 'running',
  total_jobs int DEFAULT 0,
  apify_run_id text,
  compute_units numeric,
  cost_usd numeric,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE indeed_job_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_indeed_job_searches" ON indeed_job_searches FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_indeed_job_searches" ON indeed_job_searches FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_indeed_job_searches" ON indeed_job_searches FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_indeed_job_searches" ON indeed_job_searches FOR DELETE TO anon, authenticated USING (true);

-- indeed_jobs
CREATE TABLE IF NOT EXISTS indeed_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES indeed_job_searches(id) ON DELETE CASCADE,
  indeed_key text,
  job_url text,
  apply_url text,
  job_title text,
  company_name text,
  company_page_url text,
  company_logo_url text,
  location_city text,
  location_state text,
  location_display text,
  salary_min numeric,
  salary_max numeric,
  salary_unit text,
  salary_currency text,
  employment_type text,
  is_remote boolean DEFAULT false,
  is_urgent boolean DEFAULT false,
  date_published timestamptz,
  job_description text,
  benefits jsonb DEFAULT '{}',
  attributes jsonb DEFAULT '{}',
  occupations jsonb DEFAULT '{}',
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS indeed_jobs_search_id_idx ON indeed_jobs(search_id);

ALTER TABLE indeed_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_indeed_jobs" ON indeed_jobs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_indeed_jobs" ON indeed_jobs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_indeed_jobs" ON indeed_jobs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_indeed_jobs" ON indeed_jobs FOR DELETE TO anon, authenticated USING (true);

-- Extend job_match_scores for Indeed
ALTER TABLE job_match_scores ADD COLUMN IF NOT EXISTS indeed_job_id uuid REFERENCES indeed_jobs(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS job_match_scores_profile_indeed_uidx;
CREATE UNIQUE INDEX job_match_scores_profile_indeed_uidx
  ON job_match_scores(profile_id, indeed_job_id)
  WHERE indeed_job_id IS NOT NULL;
