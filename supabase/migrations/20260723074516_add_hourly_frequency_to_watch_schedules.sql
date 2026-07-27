/*
# Add hourly frequency to watch_schedules

## Summary
Adds 'hourly' as a valid frequency option for watch schedules. This allows users
to configure more frequent automated radar scans for time-sensitive job searches.

## Modified Tables
- watch_schedules: updated frequency CHECK constraint to include 'hourly'

## Important Notes
1. Uses ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT pattern since CHECK
   constraints cannot be modified in-place.
2. Existing data is unaffected since 'hourly' is additive.
*/

ALTER TABLE watch_schedules DROP CONSTRAINT IF EXISTS watch_schedules_frequency_check;
ALTER TABLE watch_schedules ADD CONSTRAINT watch_schedules_frequency_check
  CHECK (frequency IN ('hourly', 'daily', 'twice_daily', 'weekly'));
