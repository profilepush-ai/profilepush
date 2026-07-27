/*
# Create landing_screenshots table + landing-assets storage bucket

## Purpose
Allows authenticated users to upload and manage feature screenshots displayed on the public landing page.

## New Tables
- `landing_screenshots`
  - `id` (uuid, primary key)
  - `feature_key` (text, unique) — identifier for each landing page feature slot
  - `image_url` (text) — public URL of the uploaded screenshot
  - `updated_at` (timestamptz) — last update timestamp

## Storage
- Creates the `landing-assets` bucket as a public bucket for landing page media.
- Public SELECT on all objects in the bucket (anyone can view screenshots).
- Authenticated users can INSERT and UPDATE objects (upload screenshots).

## Security
- RLS enabled on `landing_screenshots`.
- Public (anon + authenticated) can SELECT screenshots — needed for the public landing page.
- Authenticated users can INSERT and UPDATE screenshot records.
*/

-- Storage bucket for landing page assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('landing-assets', 'landing-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "landing_assets_public_read" ON storage.objects;
CREATE POLICY "landing_assets_public_read" ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'landing-assets');

DROP POLICY IF EXISTS "landing_assets_auth_insert" ON storage.objects;
CREATE POLICY "landing_assets_auth_insert" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'landing-assets');

DROP POLICY IF EXISTS "landing_assets_auth_update" ON storage.objects;
CREATE POLICY "landing_assets_auth_update" ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'landing-assets')
  WITH CHECK (bucket_id = 'landing-assets');

DROP POLICY IF EXISTS "landing_assets_auth_delete" ON storage.objects;
CREATE POLICY "landing_assets_auth_delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'landing-assets');

-- Table
CREATE TABLE IF NOT EXISTS landing_screenshots (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key text        UNIQUE NOT NULL,
  image_url   text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE landing_screenshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_landing_screenshots" ON landing_screenshots;
CREATE POLICY "public_read_landing_screenshots" ON landing_screenshots FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "auth_insert_landing_screenshots" ON landing_screenshots;
CREATE POLICY "auth_insert_landing_screenshots" ON landing_screenshots FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_landing_screenshots" ON landing_screenshots;
CREATE POLICY "auth_update_landing_screenshots" ON landing_screenshots FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);
