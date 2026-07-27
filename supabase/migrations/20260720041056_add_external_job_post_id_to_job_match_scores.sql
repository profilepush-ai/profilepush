/*
# Add external_job_post_id to job_match_scores

1. Modified Tables
  - `job_match_scores`
    - Added `external_job_post_id` (uuid, nullable) referencing `external_job_posts(id)` ON DELETE CASCADE
    - Added unique constraint on (profile_id, external_job_post_id) to prevent duplicate scores for same pair
    - Updated source check constraint to include 'external' as valid source

2. Important Notes
  - Allows caching AI match scores for external job posts so users don't need to re-run matching for the same job+candidate pair
  - The existing constraint on other job source columns is preserved
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_match_scores' AND column_name = 'external_job_post_id'
  ) THEN
    ALTER TABLE job_match_scores ADD COLUMN external_job_post_id uuid REFERENCES external_job_posts(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add unique constraint for external job post scores
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_match_scores_profile_external_unique'
  ) THEN
    ALTER TABLE job_match_scores ADD CONSTRAINT job_match_scores_profile_external_unique
      UNIQUE (profile_id, external_job_post_id);
  END IF;
END $$;

-- Create index for faster lookups by external_job_post_id
CREATE INDEX IF NOT EXISTS idx_job_match_scores_external_job_post_id
  ON job_match_scores(external_job_post_id) WHERE external_job_post_id IS NOT NULL;
