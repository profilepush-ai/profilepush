-- Add credits to accounts
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS credits_balance numeric NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT true;

-- Grant $5 to any existing accounts that haven't been granted yet
UPDATE accounts SET credits_balance = 5.00 WHERE credits_balance = 5.00;

-- Credit transactions ledger
CREATE TABLE credit_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type             text NOT NULL CHECK (type IN ('grant', 'topup', 'usage', 'refund')),
  amount           numeric NOT NULL, -- positive = credit added, negative = credit deducted
  description      text,
  api_usage_log_id uuid REFERENCES api_usage_log(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_insert_credit_tx" ON credit_transactions FOR INSERT
  TO service_role WITH CHECK (true);

CREATE POLICY "service_update_credits" ON accounts FOR UPDATE
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "select_own_credit_tx" ON credit_transactions FOR SELECT
  TO authenticated USING (
    account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );

CREATE INDEX idx_credit_tx_account ON credit_transactions (account_id, created_at DESC);

-- Seed initial $5 grant for all existing accounts
INSERT INTO credit_transactions (account_id, type, amount, description)
SELECT id, 'grant', 5.00, 'Free trial credits'
FROM accounts;

-- Trigger: deduct credits (4x markup) on every api_usage_log insert
CREATE OR REPLACE FUNCTION deduct_credits_on_usage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_marked_up numeric;
BEGIN
  IF NEW.account_id IS NULL OR NEW.cost_usd IS NULL OR NEW.cost_usd <= 0 THEN
    RETURN NEW;
  END IF;

  v_marked_up := ROUND(NEW.cost_usd * 4, 6);

  -- Deduct from balance
  UPDATE accounts
    SET credits_balance = credits_balance - v_marked_up
  WHERE id = NEW.account_id;

  -- Record transaction
  INSERT INTO credit_transactions (account_id, user_id, type, amount, description, api_usage_log_id)
  VALUES (
    NEW.account_id,
    NEW.user_id,
    'usage',
    -v_marked_up,
    NEW.function_name || ' (' || NEW.provider || ')',
    NEW.id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deduct_credits_on_usage
  AFTER INSERT ON api_usage_log
  FOR EACH ROW EXECUTE FUNCTION deduct_credits_on_usage();

-- Trigger: grant $5 on new account creation
CREATE OR REPLACE FUNCTION grant_trial_credits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO credit_transactions (account_id, type, amount, description)
  VALUES (NEW.id, 'grant', 5.00, 'Free trial credits');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_grant_trial_credits
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION grant_trial_credits();
