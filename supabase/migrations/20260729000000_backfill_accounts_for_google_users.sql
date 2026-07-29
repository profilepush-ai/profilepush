/*
# Backfill accounts and account_members for Google OAuth users

## Problem
Users who signed up via Google OAuth before the fix was deployed were added to
auth.users but never had a corresponding row created in `accounts` or
`account_members`. This left them with no workspace and caused the app to show
a blank state or error after login.

## What this migration does
For every row in auth.users that has NO active entry in account_members:
  1. Creates a new `accounts` row using the user's full_name metadata (or email
     prefix) as the workspace name and the user's id as owner_id.
  2. Inserts an `account_members` row with role = 'owner' and status = 'active'.

## Safety
- Wrapped in a transaction so it is all-or-nothing.
- Uses INSERT … ON CONFLICT DO NOTHING to be idempotent if run more than once.
- Only touches users that have NO active account_members row at all — existing
  users with a properly configured workspace are completely unaffected.
*/

DO $$
DECLARE
  rec RECORD;
  new_account_id uuid;
  workspace_name text;
BEGIN
  FOR rec IN
    SELECT
      u.id,
      u.email,
      u.raw_user_meta_data->>'full_name' AS full_name,
      u.raw_user_meta_data->>'name'      AS display_name
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1
      FROM account_members am
      WHERE am.user_id = u.id
        AND am.status  = 'active'
    )
  LOOP
    -- Derive a sensible workspace name
    workspace_name := COALESCE(
      NULLIF(TRIM(rec.full_name), ''),
      NULLIF(TRIM(rec.display_name), ''),
      SPLIT_PART(rec.email, '@', 1),
      'My Workspace'
    );

    new_account_id := gen_random_uuid();

    INSERT INTO accounts (id, name, owner_id, created_at)
    VALUES (new_account_id, workspace_name, rec.id, now())
    ON CONFLICT DO NOTHING;

    INSERT INTO account_members (account_id, user_id, invited_email, role, status, created_at)
    VALUES (new_account_id, rec.id, rec.email, 'owner', 'active', now())
    ON CONFLICT DO NOTHING;

  END LOOP;
END;
$$;
