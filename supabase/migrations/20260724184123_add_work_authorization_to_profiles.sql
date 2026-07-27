/*
# Add work_authorization column to profiles

1. Modified Tables
   - `profiles`
     - `work_authorization` (text, nullable) — stores the employment engagement type: C2C, W2, 1099, etc.

2. Important Notes
   - Column is nullable since existing profiles may not have this set.
   - No RLS changes needed — existing policies cover this column.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'work_authorization'
  ) THEN
    ALTER TABLE profiles ADD COLUMN work_authorization text;
  END IF;
END $$;
