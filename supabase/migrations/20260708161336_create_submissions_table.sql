/*
# Create submissions table

## Summary
Adds a submissions table for tracking candidate job submissions to clients/vendors.
Each submission is scoped to an account (workspace) and records full placement details.

## New Tables

### submissions
- `id` (uuid, primary key)
- `account_id` (uuid, FK → accounts, defaults to current user's account via get_current_account_id())
- `candidate_name` (text, required) — name of the submitted candidate
- `skill_set` (text) — candidate's key skills
- `vendor_name` (text) — staffing vendor name
- `vendor_email` (text) — vendor contact email
- `vendor_contact` (text) — vendor phone/contact number
- `client_name` (text) — end client name
- `job_location` (text) — job work location
- `rate` (text) — bill/pay rate (stored as text to allow "$45/hr", "60k", etc.)
- `submitted_by` (text) — name of the recruiter who made the submission
- `submission_date` (date, defaults to today) — date of submission
- `created_at` (timestamptz)

## Security
- RLS enabled.
- Four separate policies (SELECT/INSERT/UPDATE/DELETE) scoped `TO authenticated`
  using `account_id = get_current_account_id()` for workspace isolation.
*/

CREATE TABLE IF NOT EXISTS submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid REFERENCES accounts(id) ON DELETE CASCADE
                    DEFAULT get_current_account_id(),
  candidate_name  text NOT NULL,
  skill_set       text NOT NULL DEFAULT '',
  vendor_name     text NOT NULL DEFAULT '',
  vendor_email    text NOT NULL DEFAULT '',
  vendor_contact  text NOT NULL DEFAULT '',
  client_name     text NOT NULL DEFAULT '',
  job_location    text NOT NULL DEFAULT '',
  rate            text NOT NULL DEFAULT '',
  submitted_by    text NOT NULL DEFAULT '',
  submission_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_account_submissions" ON submissions;
CREATE POLICY "select_account_submissions" ON submissions FOR SELECT
  TO authenticated
  USING (account_id = get_current_account_id());

DROP POLICY IF EXISTS "insert_account_submissions" ON submissions;
CREATE POLICY "insert_account_submissions" ON submissions FOR INSERT
  TO authenticated
  WITH CHECK (account_id = get_current_account_id());

DROP POLICY IF EXISTS "update_account_submissions" ON submissions;
CREATE POLICY "update_account_submissions" ON submissions FOR UPDATE
  TO authenticated
  USING (account_id = get_current_account_id())
  WITH CHECK (account_id = get_current_account_id());

DROP POLICY IF EXISTS "delete_account_submissions" ON submissions;
CREATE POLICY "delete_account_submissions" ON submissions FOR DELETE
  TO authenticated
  USING (account_id = get_current_account_id());

CREATE INDEX IF NOT EXISTS submissions_account_id_idx ON submissions(account_id);
CREATE INDEX IF NOT EXISTS submissions_submission_date_idx ON submissions(submission_date DESC);
