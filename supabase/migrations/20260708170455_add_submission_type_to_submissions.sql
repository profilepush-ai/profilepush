/*
# Add submission_type to submissions table

Adds a `submission_type` column to track whether a submission is to a
"Client & Vendor" or is a direct "Candidate" submission.
*/

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS submission_type text NOT NULL DEFAULT '';
