/*
# Hotlist cron job and active profiles view

## What this does

1. Enables pg_cron for scheduled tasks.
2. Creates a daily cron job to purge hotlist rows where the linked profile
   is older than 15 days. Runs every day at 00:30 UTC.
3. Creates a `hotlist_active_profiles` view that shows only hotlist entries
   whose profiles are within the 15-day retention window. Joined with profiles
   so you can query display name, email, skills, etc.

## Safety
- The cron job runs as the `postgres` user with SECURITY DEFINER, so it has
  access to all tables even if public RLS would block it.
- Only deletes hotlist rows—never touches the profile itself.
*/

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create the cron job to purge old hotlist rows every day at 00:30 UTC
-- The job deletes hotlist rows where the associated profile is older than 15 days
SELECT cron.schedule(
  'purge-old-hotlist-rows',
  '30 0 * * *',  -- Daily at 00:30 UTC
  $$
  DELETE FROM hotlist
  WHERE profile_id IN (
    SELECT h.profile_id
    FROM hotlist h
    INNER JOIN profiles p ON h.profile_id = p.id
    WHERE (NOW() - INTERVAL '15 days') > p.created_at
  );
  $$
);

-- Create a view for active hotlist profiles
-- Filters to only show profiles within the 15-day retention window
DROP VIEW IF EXISTS hotlist_active_profiles CASCADE;
CREATE VIEW hotlist_active_profiles AS
  SELECT
    h.id,
    h.profile_id,
    h.account_id,
    h.added_by,
    h.created_at AS added_at,
    p.candidate_name,
    p.email,
    p.phone,
    p.target_role,
    p.location,
    p.city,
    p.state,
    p.country,
    p.core_skills,
    p.years_experience,
    p.visa_status,
    p.work_type,
    p.notice_period,
    p.created_at AS profile_created_at
  FROM hotlist h
  INNER JOIN profiles p ON h.profile_id = p.id
  WHERE (NOW() - INTERVAL '15 days') <= p.created_at
  ORDER BY h.created_at DESC;

GRANT SELECT ON hotlist_active_profiles TO authenticated;
