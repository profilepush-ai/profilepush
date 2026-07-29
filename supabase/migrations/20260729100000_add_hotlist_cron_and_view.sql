/*
# Hotlist cron job and active profiles view

## What this does

1. Creates a daily cron job to purge hotlist rows where the linked profile
   is older than 15 days. Runs every day at 00:30 UTC.
2. Creates a `hotlist_active_profiles` view that shows only hotlist entries
   whose profiles are within the 15-day retention window, with Job Watch AI status.
   Includes: profile details, watch schedule ID, watch status (on/off), frequency, last run time.

## Job Watch AI Status Rules

- **watch_status = 'on'**: A watch_schedules entry exists for this profile AND is_active = true
- **watch_status = 'off'**: No watch_schedules entry exists OR is_active = false
- **Default behavior**: Profiles are NOT automatically added to job watch when added to hotlist
- **Manual opt-in**: User must explicitly create a watch_schedules entry for a profile to enable watching
- **Global watch**: There's always an account-level watch schedule (profile_id = null) that runs regardless

## Safety
- The cron job runs as the `postgres` user with SECURITY DEFINER, so it has
  access to all tables even if public RLS would block it.
- Only deletes hotlist rows—never touches the profile itself.
*/

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

-- Create a view for active hotlist profiles with Job Watch AI status
-- Filters to only show profiles within the 15-day retention window
-- Includes Job Watch AI status: 'on' if watch schedule exists and is_active=true, 'off' otherwise
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
    p.created_at AS profile_created_at,
    -- Job Watch AI status fields
    ws.id AS watch_schedule_id,
    CASE WHEN ws.id IS NOT NULL AND ws.is_active = true THEN 'on' ELSE 'off' END AS watch_status,
    COALESCE(ws.frequency, 'daily') AS watch_frequency,
    ws.last_run_at AS watch_last_run_at
  FROM hotlist h
  INNER JOIN profiles p ON h.profile_id = p.id
  LEFT JOIN watch_schedules ws ON ws.profile_id = h.profile_id 
    AND ws.account_id = h.account_id
  WHERE (NOW() - INTERVAL '15 days') <= p.created_at
  ORDER BY h.created_at DESC;

GRANT SELECT ON hotlist_active_profiles TO authenticated;
