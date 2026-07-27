
-- Add user_id so we can track which team member performed each action
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Add indexes for fast team-activity queries
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
