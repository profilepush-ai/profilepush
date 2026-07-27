/*
# Scope external_job_posts RLS to current user

## Summary
Tightens RLS policies on the external_job_posts table so each authenticated user
can only see, insert, update, and delete their own rows (matched by user_id = auth.uid()).

## Security Changes
- SELECT: restricted to rows where user_id = auth.uid()
- INSERT: restricted to rows where user_id = auth.uid() (column defaults to auth.uid())
- UPDATE: restricted to own rows
- DELETE: restricted to own rows

## Notes
1. The user_id column already has DEFAULT auth.uid(), so frontend inserts work without explicitly passing user_id.
2. Previously all policies used USING (true), which allowed any authenticated user to see all posts.
*/

DROP POLICY IF EXISTS "select_external_job_posts" ON external_job_posts;
CREATE POLICY "select_external_job_posts" ON external_job_posts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_external_job_posts" ON external_job_posts;
CREATE POLICY "insert_external_job_posts" ON external_job_posts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_external_job_posts" ON external_job_posts;
CREATE POLICY "update_external_job_posts" ON external_job_posts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_external_job_posts" ON external_job_posts;
CREATE POLICY "delete_external_job_posts" ON external_job_posts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
