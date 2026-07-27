/*
# Add source and POC fields to external_job_posts

## Summary
Adds job source classification and point-of-contact fields to external_job_posts
so users can track where a job came from and who to contact about it.

## Modified Tables
- `external_job_posts`
  - `source` (text) - Where the job came from: Client, Vendor, Social Media, Others
  - `poc_name` (text) - Name of the point of contact
  - `poc_email` (text) - Email of the point of contact
  - `poc_phone` (text) - Phone number of the point of contact

## Notes
1. All new columns are nullable to remain backward-compatible with existing rows.
2. No RLS changes needed — existing owner-scoped policies cover the new columns.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'external_job_posts' AND column_name = 'source') THEN
    ALTER TABLE external_job_posts ADD COLUMN source text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'external_job_posts' AND column_name = 'poc_name') THEN
    ALTER TABLE external_job_posts ADD COLUMN poc_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'external_job_posts' AND column_name = 'poc_email') THEN
    ALTER TABLE external_job_posts ADD COLUMN poc_email text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'external_job_posts' AND column_name = 'poc_phone') THEN
    ALTER TABLE external_job_posts ADD COLUMN poc_phone text;
  END IF;
END $$;
