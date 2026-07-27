/*
# Add phone column to webinar_registrations

1. Modified Tables
   - `webinar_registrations`
     - Added `phone` (text, nullable) — registrant's phone number

2. Notes
   - Phone is nullable to avoid breaking existing rows.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webinar_registrations' AND column_name = 'phone'
  ) THEN
    ALTER TABLE webinar_registrations ADD COLUMN phone text;
  END IF;
END $$;
