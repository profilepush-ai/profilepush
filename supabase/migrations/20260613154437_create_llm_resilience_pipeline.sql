
-- ── Circuit breaker state per provider/model ────────────────────────────────
CREATE TABLE llm_circuit_breakers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL,
  model        text NOT NULL,
  state        text NOT NULL DEFAULT 'closed'
                 CHECK (state IN ('closed', 'open', 'half_open')),
  failure_count integer NOT NULL DEFAULT 0,
  last_failure_at timestamptz,
  opened_at    timestamptz,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE(provider, model)
);

ALTER TABLE llm_circuit_breakers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_circuit_breakers" ON llm_circuit_breakers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Async LLM job queue ──────────────────────────────────────────────────────
CREATE TABLE llm_job_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL CHECK (type IN ('parse-resume', 'score-job-match')),
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  account_id   uuid REFERENCES accounts(id)   ON DELETE SET NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  result       jsonb,
  error        text,
  provider_used text,
  model_used   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  process_after timestamptz DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE llm_job_queue ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "service_all_llm_queue" ON llm_job_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can read their own jobs (by user_id or account membership)
CREATE POLICY "select_own_llm_queue" ON llm_job_queue
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION touch_llm_job_queue()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_llm_job_queue_updated
  BEFORE UPDATE ON llm_job_queue
  FOR EACH ROW EXECUTE FUNCTION touch_llm_job_queue();

-- Atomic "claim next pending job" — prevents double-processing under concurrency
CREATE OR REPLACE FUNCTION claim_next_llm_job()
RETURNS SETOF llm_job_queue LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE llm_job_queue
  SET status = 'processing', attempts = attempts + 1, updated_at = now()
  WHERE id = (
    SELECT id FROM llm_job_queue
    WHERE  status = 'pending'
      AND  process_after <= now()
      AND  attempts < max_attempts
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- Expose queue to Supabase Realtime so the UI can subscribe
ALTER PUBLICATION supabase_realtime ADD TABLE llm_job_queue;
