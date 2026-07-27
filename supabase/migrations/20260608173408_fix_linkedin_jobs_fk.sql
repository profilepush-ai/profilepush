-- Drop the stale FK pointing to the old table name
ALTER TABLE linkedin_jobs DROP CONSTRAINT IF EXISTS linkedin_jobs_search_id_fkey;

-- Add the correct FK pointing to linkedin_job_searches
ALTER TABLE linkedin_jobs
  ADD CONSTRAINT linkedin_jobs_search_id_fkey
  FOREIGN KEY (search_id) REFERENCES linkedin_job_searches(id) ON DELETE CASCADE;
