ALTER TABLE wishlisted_jobs
  ADD COLUMN IF NOT EXISTS source_job_id text;
