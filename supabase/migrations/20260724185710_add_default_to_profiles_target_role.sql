/*
# Add default empty string to target_role column

1. Modified Tables
   - `profiles`
     - `target_role` — add DEFAULT '' so early profile creation (before user fills in form) succeeds.

2. Important Notes
   - This does not change existing data.
   - The column remains NOT NULL; it just gets an empty placeholder by default.
*/

ALTER TABLE profiles ALTER COLUMN target_role SET DEFAULT '';
