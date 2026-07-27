/*
# Add external_job_post_id to watch_schedules and make profile_id nullable

## Summary
Allows watch schedules to be created from the AI Bench Match page where a job
description drives the schedule (not a profile). Adds a nullable FK to
external_job_posts so a schedule can be tied to either a profile OR a job post.

## Modified Tables
### watch_schedules
- profile_id: changed from NOT NULL to nullable
- external_job_post_id (uuid, nullable, FK to external_job_posts)

## Notes
- A schedule must have at least one of profile_id or external_job_post_id set.
- Existing schedules are unaffected (they already have profile_id populated).
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'watch_schedules' AND column_name = 'external_job_post_id'
  ) THEN
    ALTER TABLE watch_schedules ADD COLUMN external_job_post_id uuid REFERENCES external_job_posts(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE watch_schedules ALTER COLUMN profile_id DROP NOT NULL;
