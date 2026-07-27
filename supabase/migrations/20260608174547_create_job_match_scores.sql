CREATE TABLE IF NOT EXISTS job_match_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  linkedin_job_id uuid NOT NULL REFERENCES linkedin_jobs(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  summary text NOT NULL DEFAULT '',
  strengths jsonb NOT NULL DEFAULT '[]',
  gaps jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  UNIQUE (profile_id, linkedin_job_id)
);

ALTER TABLE job_match_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_job_match_scores" ON job_match_scores FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_job_match_scores" ON job_match_scores FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_job_match_scores" ON job_match_scores FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_job_match_scores" ON job_match_scores FOR DELETE TO anon, authenticated USING (true);
