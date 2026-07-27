/*
# Create social_jobs table

## Summary
Stores job posts ingested from social media platforms (LinkedIn posts, X/Twitter, Facebook groups, etc.)
via webhook. Used by Job Match AI schedules and live runs to match candidates against social job posts.

## New Tables
- `social_jobs`
  - `id` (uuid, primary key)
  - `account_id` (uuid, FK to accounts.id, nullable — set if webhook includes it)
  - `post_id` (text, NOT NULL) — unique post identifier from the platform
  - `platform` (text, NOT NULL) — platform name: linkedin, twitter, facebook, etc.
  - `posted_by_name` (text) — name of the recruiter/poster
  - `posted_at` (timestamptz) — when the post was originally published
  - `profile_link` (text) — link to the poster's profile
  - `poster_email` (text) — recruiter's email if available
  - `poster_phone` (text) — recruiter's phone if available
  - `post_content` (text, NOT NULL) — full raw text of the job post
  - `post_url` (text) — direct link to the original post
  --- Job matching fields (same as other job tables) ---
  - `job_title` (text) — extracted job title
  - `company_name` (text) — extracted company
  - `location` (text) — extracted location
  - `employment_type` (text) — full-time, contract, C2C, etc.
  - `seniority_level` (text) — senior, mid, junior, etc.
  - `job_description` (text) — cleaned/parsed job description for matching
  - `salary_range` (text) — salary or rate info as displayed
  --- AI-extracted fields for radar matching ---
  - `extracted_skills` (jsonb) — array of extracted skill keywords
  - `extracted_experience_years` (integer) — years of experience required
  - `extracted_visa_types` (jsonb) — array of accepted visa types
  - `extracted_hourly_rate_min` (numeric) — minimum hourly rate
  - `extracted_hourly_rate_max` (numeric) — maximum hourly rate
  - `extracted_role_normalized` (text) — normalized role title
  - `radar_enriched` (boolean) — whether radar enrichment has been run
  - `created_at` (timestamptz)

## Security
- RLS enabled.
- Single-tenant (anon + authenticated) full CRUD — data comes from webhooks.

## Notes
1. post_id + platform are unique together to prevent duplicate imports.
2. The extracted_* fields are populated by the radar-enrich function after ingestion.
3. This table integrates with radar-match the same way linkedin_jobs, dice_jobs, etc. do.
*/

CREATE TABLE IF NOT EXISTS social_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  post_id text NOT NULL,
  platform text NOT NULL,
  posted_by_name text NOT NULL DEFAULT '',
  posted_at timestamptz,
  profile_link text NOT NULL DEFAULT '',
  poster_email text NOT NULL DEFAULT '',
  poster_phone text NOT NULL DEFAULT '',
  post_content text NOT NULL,
  post_url text NOT NULL DEFAULT '',
  -- Job matching fields
  job_title text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  employment_type text NOT NULL DEFAULT '',
  seniority_level text NOT NULL DEFAULT '',
  job_description text NOT NULL DEFAULT '',
  salary_range text NOT NULL DEFAULT '',
  -- AI-extracted fields for radar matching
  extracted_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  extracted_experience_years integer,
  extracted_visa_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  extracted_hourly_rate_min numeric,
  extracted_hourly_rate_max numeric,
  extracted_role_normalized text,
  radar_enriched boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint to prevent duplicate posts
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_jobs_post_platform ON social_jobs(post_id, platform);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_social_jobs_created_at ON social_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_jobs_account_id ON social_jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_social_jobs_platform ON social_jobs(platform);

ALTER TABLE social_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_social_jobs" ON social_jobs;
CREATE POLICY "anon_select_social_jobs" ON social_jobs FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_social_jobs" ON social_jobs;
CREATE POLICY "anon_insert_social_jobs" ON social_jobs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_social_jobs" ON social_jobs;
CREATE POLICY "anon_update_social_jobs" ON social_jobs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_social_jobs" ON social_jobs;
CREATE POLICY "anon_delete_social_jobs" ON social_jobs FOR DELETE
  TO anon, authenticated USING (true);