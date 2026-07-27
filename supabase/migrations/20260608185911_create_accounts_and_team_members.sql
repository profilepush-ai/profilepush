/*
# Create accounts and account_members tables

## Summary
Adds multi-tenant account management to ProfilePush. Each account represents a
business (e.g. a staffing agency). Users belong to one account with a role.
Invites are tracked by email so members can be added before they sign up.

## New Tables

### accounts
- id (uuid, PK)
- name (text) — business name entered at signup
- owner_id (uuid) — references auth.users; the user who created the account
- created_at (timestamptz)

### account_members
- id (uuid, PK)
- account_id (uuid) — foreign key to accounts
- user_id (uuid, nullable) — null until the invited user actually signs up
- invited_email (text) — the email address the invite was sent to
- role (text) — 'owner' | 'admin' | 'member'
- status (text) — 'active' | 'invited'
- created_at (timestamptz)
- UNIQUE (account_id, invited_email)

## Security
- RLS enabled on both tables.
- accounts: read/update/delete only by members of that account (or owner).
- account_members:
    SELECT — any authenticated member of the same account.
    INSERT — account owner adding invites, OR a user creating their own owner row.
    UPDATE — account owner managing members, OR invited user claiming their own row.
    DELETE — account owner only.
*/

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (account_id, invited_email)
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;

-- ── accounts policies ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "select_own_account" ON accounts;
CREATE POLICY "select_own_account" ON accounts FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM account_members
    WHERE account_members.account_id = id
      AND account_members.user_id = auth.uid()
      AND account_members.status = 'active'
  )
);

DROP POLICY IF EXISTS "insert_own_account" ON accounts;
CREATE POLICY "insert_own_account" ON accounts FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "update_own_account" ON accounts;
CREATE POLICY "update_own_account" ON accounts FOR UPDATE TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "delete_own_account" ON accounts;
CREATE POLICY "delete_own_account" ON accounts FOR DELETE TO authenticated
USING (owner_id = auth.uid());

-- ── account_members policies ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "select_account_members" ON account_members;
CREATE POLICY "select_account_members" ON account_members FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM account_members am2
    WHERE am2.account_id = account_id
      AND am2.user_id = auth.uid()
      AND am2.status = 'active'
  )
);

DROP POLICY IF EXISTS "insert_account_members" ON account_members;
CREATE POLICY "insert_account_members" ON account_members FOR INSERT TO authenticated
WITH CHECK (
  -- User creating their own owner row on signup
  (user_id = auth.uid() AND role = 'owner')
  OR
  -- Account owner inviting a new member
  EXISTS (
    SELECT 1 FROM accounts
    WHERE accounts.id = account_id AND accounts.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "update_account_members" ON account_members;
CREATE POLICY "update_account_members" ON account_members FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM accounts WHERE accounts.id = account_id AND accounts.owner_id = auth.uid())
  OR (status = 'invited' AND (auth.jwt() ->> 'email') = invited_email)
)
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM accounts WHERE accounts.id = account_id AND accounts.owner_id = auth.uid())
  OR (auth.jwt() ->> 'email') = invited_email
);

DROP POLICY IF EXISTS "delete_account_members" ON account_members;
CREATE POLICY "delete_account_members" ON account_members FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM accounts WHERE accounts.id = account_id AND accounts.owner_id = auth.uid())
);
