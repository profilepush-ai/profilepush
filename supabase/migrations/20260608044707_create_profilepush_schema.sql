/*
# ProfilePush Core Schema

## Summary
Creates the four foundational tables for the ProfilePush IT recruiting SaaS application.

## New Tables

### 1. profiles
The central candidate bench. Each row represents one candidate/profile.
- id: UUID primary key
- candidate_name: Full name of the candidate
- target_role: The role they are targeting (e.g. "React Developer")
- location: City/state or remote preference
- core_skills: Comma-separated string of technical skills
- created_at: Timestamp of profile creation

### 2. resume_files
Historical ledger of uploaded resume files for each profile.
- id: UUID primary key
- profile_id: Foreign key to profiles (cascades on delete)
- file_name: Original filename of the uploaded resume
- file_url: Optional URL if stored in cloud storage
- created_at: Upload timestamp (used as "Date Modified" in UI)

### 3. wishlisted_jobs
Jobs saved to a specific candidate's wishlist from the Job Finder.
- id: UUID primary key
- profile_id: Foreign key to profiles (cascades on delete)
- job_title: Title of the job posting
- company: Hiring company name
- board: Source job board (LinkedIn, Dice, Indeed, CareerBuilder)
- location: Job location
- job_url: Link to the original posting
- status: Workflow status - 'New' or 'Applied'
- created_at: Timestamp when job was saved

### 4. activity_logs
Chronological event feed for each candidate profile.
- id: UUID primary key
- profile_id: Foreign key to profiles (cascades on delete)
- event_type: Machine-readable event category (e.g. 'profile_parsed', 'job_wishlisted')
- description: Human-readable description of the event
- created_at: Event timestamp

## Security
- RLS enabled on all four tables
- Single-tenant app (no user accounts): anon + authenticated roles get full CRUD access
- USING (true) is intentional — this is a shared-workspace agency tool, not a multi-user app

## Notes
1. All tables use gen_random_uuid() for primary keys
2. Foreign keys use ON DELETE CASCADE so deleting a profile cleans up all related records
3. Policies use TO anon, authenticated so the anon-key Supabase client can operate without sign-in
*/

-- PROFILES
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_name text NOT NULL,
  target_role text NOT NULL,
  location text NOT NULL DEFAULT '',
  core_skills text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_profiles" ON profiles;
CREATE POLICY "anon_select_profiles" ON profiles FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_profiles" ON profiles;
CREATE POLICY "anon_insert_profiles" ON profiles FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_profiles" ON profiles;
CREATE POLICY "anon_update_profiles" ON profiles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_profiles" ON profiles;
CREATE POLICY "anon_delete_profiles" ON profiles FOR DELETE TO anon, authenticated USING (true);

-- RESUME FILES
CREATE TABLE IF NOT EXISTS resume_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resume_files_profile_id_idx ON resume_files(profile_id);

ALTER TABLE resume_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_resume_files" ON resume_files;
CREATE POLICY "anon_select_resume_files" ON resume_files FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_resume_files" ON resume_files;
CREATE POLICY "anon_insert_resume_files" ON resume_files FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_resume_files" ON resume_files;
CREATE POLICY "anon_update_resume_files" ON resume_files FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_resume_files" ON resume_files;
CREATE POLICY "anon_delete_resume_files" ON resume_files FOR DELETE TO anon, authenticated USING (true);

-- WISHLISTED JOBS
CREATE TABLE IF NOT EXISTS wishlisted_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  job_title text NOT NULL,
  company text NOT NULL,
  board text NOT NULL DEFAULT 'LinkedIn',
  location text NOT NULL DEFAULT '',
  job_url text,
  status text NOT NULL DEFAULT 'New',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wishlisted_jobs_profile_id_idx ON wishlisted_jobs(profile_id);

ALTER TABLE wishlisted_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_wishlisted_jobs" ON wishlisted_jobs;
CREATE POLICY "anon_select_wishlisted_jobs" ON wishlisted_jobs FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_wishlisted_jobs" ON wishlisted_jobs;
CREATE POLICY "anon_insert_wishlisted_jobs" ON wishlisted_jobs FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_wishlisted_jobs" ON wishlisted_jobs;
CREATE POLICY "anon_update_wishlisted_jobs" ON wishlisted_jobs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_wishlisted_jobs" ON wishlisted_jobs;
CREATE POLICY "anon_delete_wishlisted_jobs" ON wishlisted_jobs FOR DELETE TO anon, authenticated USING (true);

-- ACTIVITY LOGS
CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_logs_profile_id_idx ON activity_logs(profile_id);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_activity_logs" ON activity_logs;
CREATE POLICY "anon_select_activity_logs" ON activity_logs FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_activity_logs" ON activity_logs;
CREATE POLICY "anon_insert_activity_logs" ON activity_logs FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_activity_logs" ON activity_logs;
CREATE POLICY "anon_update_activity_logs" ON activity_logs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_activity_logs" ON activity_logs;
CREATE POLICY "anon_delete_activity_logs" ON activity_logs FOR DELETE TO anon, authenticated USING (true);
