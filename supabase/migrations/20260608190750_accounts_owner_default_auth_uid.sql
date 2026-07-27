/*
# Add DEFAULT auth.uid() to accounts.owner_id

Adds a column default so inserts that omit owner_id still satisfy the RLS
INSERT policy (owner_id = auth.uid()) without the frontend explicitly passing it.
*/

ALTER TABLE accounts ALTER COLUMN owner_id SET DEFAULT auth.uid();
