/*
# Create vendors and clients tables

Adds dedicated vendor and client management tables, each workspace-scoped via account_id.

## New Tables

### vendors
- `id` (uuid, primary key)
- `account_id` (uuid, FK → accounts, defaults to current user's account)
- `name` (text, required) — vendor/company name
- `email` (text) — primary contact email
- `contact` (text) — phone / contact number
- `created_at` (timestamptz)

### clients
- `id` (uuid, primary key)
- `account_id` (uuid, FK → accounts, defaults to current user's account)
- `name` (text, required) — client/company name
- `contact_person` (text) — contact's full name
- `email` (text) — contact email
- `phone` (text) — phone number
- `location` (text) — city/state
- `created_at` (timestamptz)

## Security
RLS enabled on both tables. Four separate policies each (SELECT/INSERT/UPDATE/DELETE)
scoped TO authenticated using account_id = get_current_account_id().
*/

CREATE TABLE IF NOT EXISTS vendors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE DEFAULT get_current_account_id(),
  name       text NOT NULL,
  email      text NOT NULL DEFAULT '',
  contact    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_account_vendors" ON vendors;
CREATE POLICY "select_account_vendors" ON vendors FOR SELECT
  TO authenticated USING (account_id = get_current_account_id());

DROP POLICY IF EXISTS "insert_account_vendors" ON vendors;
CREATE POLICY "insert_account_vendors" ON vendors FOR INSERT
  TO authenticated WITH CHECK (account_id = get_current_account_id());

DROP POLICY IF EXISTS "update_account_vendors" ON vendors;
CREATE POLICY "update_account_vendors" ON vendors FOR UPDATE
  TO authenticated USING (account_id = get_current_account_id()) WITH CHECK (account_id = get_current_account_id());

DROP POLICY IF EXISTS "delete_account_vendors" ON vendors;
CREATE POLICY "delete_account_vendors" ON vendors FOR DELETE
  TO authenticated USING (account_id = get_current_account_id());

CREATE INDEX IF NOT EXISTS vendors_account_id_idx ON vendors(account_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE DEFAULT get_current_account_id(),
  name           text NOT NULL,
  contact_person text NOT NULL DEFAULT '',
  email          text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',
  location       text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_account_clients" ON clients;
CREATE POLICY "select_account_clients" ON clients FOR SELECT
  TO authenticated USING (account_id = get_current_account_id());

DROP POLICY IF EXISTS "insert_account_clients" ON clients;
CREATE POLICY "insert_account_clients" ON clients FOR INSERT
  TO authenticated WITH CHECK (account_id = get_current_account_id());

DROP POLICY IF EXISTS "update_account_clients" ON clients;
CREATE POLICY "update_account_clients" ON clients FOR UPDATE
  TO authenticated USING (account_id = get_current_account_id()) WITH CHECK (account_id = get_current_account_id());

DROP POLICY IF EXISTS "delete_account_clients" ON clients;
CREATE POLICY "delete_account_clients" ON clients FOR DELETE
  TO authenticated USING (account_id = get_current_account_id());

CREATE INDEX IF NOT EXISTS clients_account_id_idx ON clients(account_id);
