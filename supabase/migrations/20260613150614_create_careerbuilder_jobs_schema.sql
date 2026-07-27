-- careerbuilder_job_searches
CREATE TABLE IF NOT EXISTS careerbuilder_job_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  date_posted text,
  status text NOT NULL DEFAULT 'running',
  total_jobs int DEFAULT 0,
  apify_run_id text,
  compute_units numeric,
  cost_usd numeric,
  account_id uuid,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE careerbuilder_job_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_cb_searches" ON careerbuilder_job_searches FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_cb_searches" ON careerbuilder_job_searches FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_cb_searches" ON careerbuilder_job_searches FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_cb_searches" ON careerbuilder_job_searches FOR DELETE TO anon, authenticated USING (true);

-- careerbuilder_jobs
CREATE TABLE IF NOT EXISTS careerbuilder_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES careerbuilder_job_searches(id) ON DELETE CASCADE,
  cb_key text,
  job_url text,
  apply_url text,
  job_title text,
  company_name text,
  location_city text,
  location_state text,
  location_display text,
  salary_display text,
  salary_currency text,
  salary_unit text,
  employment_type text,
  is_remote boolean DEFAULT false,
  is_promoted boolean DEFAULT false,
  date_published timestamptz,
  date_recency text,
  short_description text,
  job_description text,
  skills jsonb DEFAULT '[]',
  benefits_list jsonb DEFAULT '[]',
  occupational_category text,
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cb_jobs_search_id_idx ON careerbuilder_jobs(search_id);

ALTER TABLE careerbuilder_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_cb_jobs" ON careerbuilder_jobs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_cb_jobs" ON careerbuilder_jobs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_cb_jobs" ON careerbuilder_jobs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_cb_jobs" ON careerbuilder_jobs FOR DELETE TO anon, authenticated USING (true);

-- Extend job_match_scores for CareerBuilder
ALTER TABLE job_match_scores ADD COLUMN IF NOT EXISTS careerbuilder_job_id uuid REFERENCES careerbuilder_jobs(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS job_match_scores_profile_cb_uidx;
CREATE UNIQUE INDEX job_match_scores_profile_cb_uidx
  ON job_match_scores(profile_id, careerbuilder_job_id)
  WHERE careerbuilder_job_id IS NOT NULL;
