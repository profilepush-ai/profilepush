-- Resets credits_balance to 5.00 for all free-plan accounts (is_trial = true).
-- Call this monthly via the refresh-free-credits edge function.
CREATE OR REPLACE FUNCTION refresh_free_plan_credits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
  v_account RECORD;
BEGIN
  FOR v_account IN
    SELECT id FROM accounts WHERE is_trial = true
  LOOP
    UPDATE accounts SET credits_balance = 5.00 WHERE id = v_account.id;

    INSERT INTO credit_transactions (account_id, type, amount, description)
    VALUES (v_account.id, 'grant', 5.00, 'Free plan monthly credit refresh');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
