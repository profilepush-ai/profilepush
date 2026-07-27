/*
# Fix infinite recursion in account_members and accounts SELECT policies

## Problem
The `account_members` SELECT policy contained a self-referential EXISTS subquery:
  EXISTS (SELECT 1 FROM account_members am2 WHERE am2.account_id = account_id AND am2.user_id = auth.uid())
Querying `account_members` from within its own SELECT policy triggers that same
policy again, causing PostgreSQL to abort with "infinite recursion detected".

The `accounts` SELECT policy had the same issue indirectly: it queried
`account_members` directly, which triggered the self-referential SELECT policy.

## Fix
Replace both self-referential subqueries with calls to `get_current_account_id()`,
which is already a SECURITY DEFINER function. Because SECURITY DEFINER functions
execute as the postgres role, they bypass RLS entirely when they query
`account_members`. No recursive policy evaluation occurs.

- `account_members` SELECT: `user_id = auth.uid() OR account_id = get_current_account_id()`
- `accounts` SELECT: `id = get_current_account_id()`
*/

DROP POLICY IF EXISTS "select_account_members" ON account_members;
CREATE POLICY "select_account_members" ON account_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR account_id = get_current_account_id()
  );

DROP POLICY IF EXISTS "select_own_account" ON accounts;
CREATE POLICY "select_own_account" ON accounts FOR SELECT
  TO authenticated
  USING (id = get_current_account_id());
