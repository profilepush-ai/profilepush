-- Add rewrite tracking columns to wishlisted_jobs
ALTER TABLE wishlisted_jobs
  ADD COLUMN IF NOT EXISTS rewrite_job_id   uuid  REFERENCES llm_job_queue(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rewrite_file_url text,
  ADD COLUMN IF NOT EXISTS rewrite_file_name text;

-- Index for quick lookup of rewrite status
CREATE INDEX IF NOT EXISTS wishlisted_jobs_rewrite_job_id_idx ON wishlisted_jobs(rewrite_job_id);

-- Expose new columns via RLS (already inherited from existing table policies)
-- No new policies needed as existing wishlisted_jobs policies cover all columns
