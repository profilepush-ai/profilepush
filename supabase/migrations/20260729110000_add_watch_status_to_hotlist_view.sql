/*
# Update hotlist_active_profiles view with Job Watch AI status

Adds Job Watch AI status information to the existing hotlist_active_profiles view:
- watch_schedule_id: ID of the watch_schedules record (if exists)
- watch_status: 'on' if watch exists and is_active=true, 'off' otherwise
- watch_frequency: How often the watch runs (daily, twice_daily, weekly)
- watch_last_run_at: When the watch schedule last executed
*/

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
