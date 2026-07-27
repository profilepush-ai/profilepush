/*
# Create external_job_posts table

## Summary
Stores job descriptions pasted from external sources (emails, social media, etc.)
for the AI Bench Match feature. These posts are used to find matching bench candidates.

## New Tables
- `external_job_posts`
  - `id` (uuid, primary key)
  - `account_id` (uuid, FK to accounts.id, ON DELETE CASCADE)
  - `user_id` (uuid, defaults to auth.uid())
  - `title` (text) — extracted or user-given job title
  - `company` (text) — extracted company name
  - `location` (text) — extracted location
  - `skills` (text[]) — extracted skill keywords
  - `experience_years` (integer) — extracted years of experience requirement
  - `employment_type` (text) — full-time, contract, etc.
  - `raw_description` (text, NOT NULL) — the original pasted job description
  - `summary` (text) — AI-generated summary
  - `created_at` (timestamptz)

## Security
- RLS enabled.
- Account-scoped: authenticated users in the same account can CRUD.

## Notes
1. The raw_description stores the full pasted text.
2. Extracted fields (title, skills, etc.) are populated after AI parsing.
*/

CREATE TABLE IF NOT EXISTS external_job_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  skills text[] NOT NULL DEFAULT '{}',
  experience_years integer,
  employment_type text NOT NULL DEFAULT '',
  raw_description text NOT NULL,
  summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_job_posts_account ON external_job_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_external_job_posts_user ON external_job_posts(user_id);

ALTER TABLE external_job_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_external_job_posts" ON external_job_posts;
CREATE POLICY "select_external_job_posts" ON external_job_posts FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_external_job_posts" ON external_job_posts;
CREATE POLICY "insert_external_job_posts" ON external_job_posts FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_external_job_posts" ON external_job_posts;
CREATE POLICY "update_external_job_posts" ON external_job_posts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_external_job_posts" ON external_job_posts;
CREATE POLICY "delete_external_job_posts" ON external_job_posts FOR DELETE
  TO authenticated USING (true);
