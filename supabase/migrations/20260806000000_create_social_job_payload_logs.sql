CREATE TABLE IF NOT EXISTS social_job_payload_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL DEFAULT 'receive-social-job',
  source text,
  payload jsonb NOT NULL,
  normalized_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  inserted_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE social_job_payload_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_insert_social_job_payload_logs"
  ON social_job_payload_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "service_select_social_job_payload_logs"
  ON social_job_payload_logs FOR SELECT
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_social_job_payload_logs_created_at
  ON social_job_payload_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_job_payload_logs_status
  ON social_job_payload_logs (status, created_at DESC);
