/*
# Create webinar_registrations table

1. New Tables
   - `webinar_registrations`
     - `id` (uuid, primary key)
     - `first_name` (text, not null)
     - `email` (text, unique, not null)
     - `agency_name` (text, nullable)
     - `created_at` (timestamptz, default now)

2. Security
   - Enable RLS on `webinar_registrations`.
   - Allow anon + authenticated INSERT (public registration form).
   - No SELECT/UPDATE/DELETE for public users (admin only via service role).
*/

CREATE TABLE IF NOT EXISTS webinar_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  email text UNIQUE NOT NULL,
  agency_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webinar_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_webinar_registrations" ON webinar_registrations;
CREATE POLICY "anon_insert_webinar_registrations" ON webinar_registrations FOR INSERT
  TO anon, authenticated WITH CHECK (true);
