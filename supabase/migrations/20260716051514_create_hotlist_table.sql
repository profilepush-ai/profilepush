/*
# Create hotlist table

Stores profiles that have been added to the user's hotlist from the bench page.
Used in the Hotlist AI page to show a curated shortlist of candidates.

1. New Tables
  - `hotlist`
    - `id` (uuid, primary key)
    - `profile_id` (uuid, FK → profiles, not null)
    - `account_id` (uuid, FK → accounts, defaults to get_current_account_id())
    - `added_by` (uuid, FK → auth.users, defaults to auth.uid())
    - `created_at` (timestamptz)

2. Security
  - Enable RLS on `hotlist`.
  - Account-scoped CRUD: authenticated users can only access rows in their own account.

3. Indexes
  - Unique constraint on (profile_id, account_id) to prevent duplicates.
*/

CREATE TABLE IF NOT EXISTS hotlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id uuid DEFAULT get_current_account_id() REFERENCES accounts(id) ON DELETE CASCADE,
  added_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS hotlist_profile_account_uniq ON hotlist (profile_id, account_id);

ALTER TABLE hotlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_hotlist" ON hotlist;
CREATE POLICY "select_own_hotlist" ON hotlist FOR SELECT
  TO authenticated USING (account_id = get_current_account_id());

DROP POLICY IF EXISTS "insert_own_hotlist" ON hotlist;
CREATE POLICY "insert_own_hotlist" ON hotlist FOR INSERT
  TO authenticated WITH CHECK (account_id = get_current_account_id());

DROP POLICY IF EXISTS "update_own_hotlist" ON hotlist;
CREATE POLICY "update_own_hotlist" ON hotlist FOR UPDATE
  TO authenticated USING (account_id = get_current_account_id()) WITH CHECK (account_id = get_current_account_id());

DROP POLICY IF EXISTS "delete_own_hotlist" ON hotlist;
CREATE POLICY "delete_own_hotlist" ON hotlist FOR DELETE
  TO authenticated USING (account_id = get_current_account_id());
