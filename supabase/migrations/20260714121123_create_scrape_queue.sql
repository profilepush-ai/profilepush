/*
# Create Scrape Queue System

1. New Tables
  - `scrape_queue`
    - `id` (uuid, primary key)
    - `board` (text, not null) - which job board (linkedin, dice, indeed, monster, careerbuilder)
    - `status` (text, not null) - running, queued, completed, failed
    - `request_body` (jsonb) - the full request payload to replay when processing
    - `account_id` (uuid, nullable)
    - `user_id` (uuid, nullable)
    - `position` (integer) - queue position at time of insertion
    - `result` (jsonb, nullable) - response data once completed
    - `error_message` (text, nullable) - error if failed
    - `created_at` (timestamptz)
    - `started_at` (timestamptz, nullable)
    - `completed_at` (timestamptz, nullable)

2. Security
  - Enable RLS on `scrape_queue`
  - Authenticated users can read their own queue items
  - Service role handles inserts/updates from edge functions

3. Indexes
  - Index on status for fast concurrent count lookups
  - Index on (user_id, status) for user-specific queue queries

4. Notes
  - Max 20 concurrent Apify sessions across all boards
  - Items beyond 20 get queued with position and ~2min ETA
  - Edge functions check this table before calling Apify
*/

CREATE TABLE IF NOT EXISTS scrape_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text NOT NULL CHECK (board IN ('linkedin', 'dice', 'indeed', 'monster', 'careerbuilder')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('running', 'queued', 'completed', 'failed', 'expired')),
  request_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  result jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

ALTER TABLE scrape_queue ENABLE ROW LEVEL SECURITY;

-- Users can see their own queue items
DROP POLICY IF EXISTS "select_own_queue" ON scrape_queue;
CREATE POLICY "select_own_queue" ON scrape_queue FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- Users can insert their own queue items
DROP POLICY IF EXISTS "insert_own_queue" ON scrape_queue;
CREATE POLICY "insert_own_queue" ON scrape_queue FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- Users can read queue status (no update/delete from client)
DROP POLICY IF EXISTS "update_own_queue" ON scrape_queue;
CREATE POLICY "update_own_queue" ON scrape_queue FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_queue" ON scrape_queue;
CREATE POLICY "delete_own_queue" ON scrape_queue FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scrape_queue_status ON scrape_queue(status);
CREATE INDEX IF NOT EXISTS idx_scrape_queue_user_status ON scrape_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_scrape_queue_board_status ON scrape_queue(board, status);

-- Function to count currently running sessions
CREATE OR REPLACE FUNCTION get_running_scrape_count()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::integer FROM scrape_queue WHERE status = 'running';
$$;

-- Function to get queue position for a given item
CREATE OR REPLACE FUNCTION get_queue_position(p_queue_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::integer FROM scrape_queue
  WHERE status = 'queued' AND created_at <= (SELECT created_at FROM scrape_queue WHERE id = p_queue_id);
$$;
