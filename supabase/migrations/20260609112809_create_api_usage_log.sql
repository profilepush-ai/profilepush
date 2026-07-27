CREATE TABLE api_usage_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid REFERENCES accounts(id) ON DELETE SET NULL,
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  function_name    text NOT NULL,
  provider         text NOT NULL CHECK (provider IN ('gemini', 'apify')),
  model            text,
  prompt_tokens    integer,
  completion_tokens integer,
  total_tokens     integer,
  compute_units    numeric,
  cost_usd         numeric,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE api_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_insert_usage" ON api_usage_log FOR INSERT
  TO service_role WITH CHECK (true);

CREATE POLICY "select_own_usage" ON api_usage_log FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );

CREATE INDEX idx_api_usage_log_created_at ON api_usage_log (created_at DESC);
CREATE INDEX idx_api_usage_log_account    ON api_usage_log (account_id, created_at DESC);
CREATE INDEX idx_api_usage_log_function   ON api_usage_log (function_name, created_at DESC);
