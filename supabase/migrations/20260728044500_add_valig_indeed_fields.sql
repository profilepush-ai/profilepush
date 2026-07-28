-- Add structured fields needed for valig~indeed-jobs-scraper output.
ALTER TABLE indeed_jobs
  ADD COLUMN IF NOT EXISTS ref_num text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS is_repost boolean,
  ADD COLUMN IF NOT EXISTS is_latest_post boolean,
  ADD COLUMN IF NOT EXISTS is_placement boolean,
  ADD COLUMN IF NOT EXISTS is_high_volume_hiring boolean,
  ADD COLUMN IF NOT EXISTS is_expired boolean,
  ADD COLUMN IF NOT EXISTS date_on_indeed timestamptz,
  ADD COLUMN IF NOT EXISTS expiration_date timestamptz,
  ADD COLUMN IF NOT EXISTS location_country text,
  ADD COLUMN IF NOT EXISTS location_country_code text,
  ADD COLUMN IF NOT EXISTS location_admin1_code text,
  ADD COLUMN IF NOT EXISTS location_postal_code text,
  ADD COLUMN IF NOT EXISTS location_latitude numeric,
  ADD COLUMN IF NOT EXISTS location_longitude numeric,
  ADD COLUMN IF NOT EXISTS employer_payload jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parent_employer_payload jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_indeed_jobs_indeed_key ON indeed_jobs (indeed_key);
CREATE INDEX IF NOT EXISTS idx_indeed_jobs_date_published ON indeed_jobs (date_published DESC);
