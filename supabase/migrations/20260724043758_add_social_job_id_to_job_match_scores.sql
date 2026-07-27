/*
# Add social_job_id to job_match_scores

## Summary
Adds a `social_job_id` column to `job_match_scores` so match results from the social_jobs table
can be persisted alongside LinkedIn, Dice, Indeed, Monster, CareerBuilder, and external sources.

## Modified Tables
- `job_match_scores`
  - Added `social_job_id` (uuid, nullable, FK to social_jobs.id ON DELETE CASCADE)
  - Updated check constraint to include social_job_id as a valid source

## Notes
1. The constraint ensures exactly one job source column is non-null per row.
2. This enables the radar-match function to store results from social_jobs.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_match_scores' AND column_name = 'social_job_id'
  ) THEN
    ALTER TABLE job_match_scores ADD COLUMN social_job_id uuid REFERENCES social_jobs(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_match_scores_social_job_id ON job_match_scores(social_job_id);

-- Update the source check constraint to include social_job_id
ALTER TABLE job_match_scores DROP CONSTRAINT IF EXISTS job_match_scores_job_source_check;

ALTER TABLE job_match_scores ADD CONSTRAINT job_match_scores_job_source_check CHECK (
  (
    ((linkedin_job_id IS NOT NULL)::integer +
     (dice_job_id IS NOT NULL)::integer +
     (indeed_job_id IS NOT NULL)::integer +
     (monster_job_id IS NOT NULL)::integer +
     (careerbuilder_job_id IS NOT NULL)::integer +
     (external_job_post_id IS NOT NULL)::integer +
     (social_job_id IS NOT NULL)::integer) = 1
  )
);