/*
# Fix job_match_scores source check to include external_job_post_id

1. Modified Tables
  - `job_match_scores`
    - Updated check constraint `job_match_scores_job_source_check` to include `external_job_post_id`
    - The constraint now requires exactly one of: linkedin_job_id, dice_job_id, indeed_job_id, monster_job_id, careerbuilder_job_id, external_job_post_id to be NOT NULL

2. Important Notes
  - Without this fix, inserts with only external_job_post_id set would violate the check constraint
  - This was the root cause of match scores not persisting for the AI Bench Match page
*/

ALTER TABLE job_match_scores DROP CONSTRAINT IF EXISTS job_match_scores_job_source_check;

ALTER TABLE job_match_scores ADD CONSTRAINT job_match_scores_job_source_check CHECK (
  (
    ((linkedin_job_id IS NOT NULL)::integer +
     (dice_job_id IS NOT NULL)::integer +
     (indeed_job_id IS NOT NULL)::integer +
     (monster_job_id IS NOT NULL)::integer +
     (careerbuilder_job_id IS NOT NULL)::integer +
     (external_job_post_id IS NOT NULL)::integer) = 1
  )
);