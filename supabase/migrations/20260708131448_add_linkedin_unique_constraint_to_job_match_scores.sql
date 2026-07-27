DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_match_scores_profile_linkedin_unique'
  ) THEN
    ALTER TABLE job_match_scores ADD CONSTRAINT job_match_scores_profile_linkedin_unique UNIQUE (profile_id, linkedin_job_id);
  END IF;
END $$;
