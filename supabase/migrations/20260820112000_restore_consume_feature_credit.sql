-- Un-stub consume_feature_credit — restore its real atomic body verbatim
-- from 20260801173500_add_consume_feature_credit_rpc.sql (the 2026-08-19
-- disable migration replaced it with a permissive always-succeeds stub).
--
-- Safe to restore in isolation: every existing frontend call site
-- (PulsePage.tsx's shared `consumeCredits` callback, used for predict-match/
-- reveal-contact/view-breakdown/view-post-content) starts with
-- `if (!shouldChargeCredits()) return true;`, and shouldChargeCredits()
-- reads BILLING_GATES_ENABLED, which stays false — those 4 legacy features
-- never reach this RPC regardless of what its body does. Only the new
-- explicit call sites being added in this change (ask-ai-vendor-email,
-- generate-chat-message, create_user_job_post/create_user_hotlist_post)
-- call this unconditionally.
CREATE OR REPLACE FUNCTION public.consume_feature_credit(
  p_account_id uuid,
  p_amount numeric,
  p_feature text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  success boolean,
  new_balance numeric,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_is_member boolean;
  v_amount numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, 'Unauthorized';
    RETURN;
  END IF;

  v_amount := ROUND(COALESCE(p_amount, 0), 4);
  IF v_amount <= 0 THEN
    RETURN QUERY SELECT false, NULL::numeric, 'Invalid credit amount';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM account_members am
    WHERE am.account_id = p_account_id
      AND am.user_id = auth.uid()
      AND am.status = 'active'
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RETURN QUERY SELECT false, NULL::numeric, 'Account access denied';
    RETURN;
  END IF;

  -- Lock and read current balance to avoid race conditions.
  SELECT a.credits_balance
  INTO v_balance
  FROM accounts a
  WHERE a.id = p_account_id
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, 'Account not found';
    RETURN;
  END IF;

  IF v_balance < v_amount THEN
    RETURN QUERY SELECT false, v_balance, 'Insufficient credits';
    RETURN;
  END IF;

  UPDATE accounts
  SET credits_balance = ROUND(COALESCE(credits_balance, 0) - v_amount, 4)
  WHERE id = p_account_id
  RETURNING credits_balance INTO v_balance;

  INSERT INTO credit_transactions (account_id, user_id, type, amount, description)
  VALUES (
    p_account_id,
    auth.uid(),
    'usage',
    -v_amount,
    CONCAT('Usage: ', COALESCE(NULLIF(TRIM(p_feature), ''), 'feature action'))
  );

  RETURN QUERY SELECT true, v_balance, 'ok';
END;
$$;

COMMENT ON FUNCTION public.consume_feature_credit(uuid, numeric, text, jsonb) IS NULL;

REVOKE ALL ON FUNCTION public.consume_feature_credit(uuid, numeric, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_feature_credit(uuid, numeric, text, jsonb) TO authenticated;
