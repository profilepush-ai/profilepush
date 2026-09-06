-- Charges the job-owning account 50 credits when a candidate finishes a
-- video screening. This fires from job-application-screening's Worker,
-- which is service-role-only and has no user JWT (auth.uid() is NULL there),
-- so it cannot use consume_feature_credit — that function requires an
-- authenticated caller with active account_members and rejects service-role
-- calls outright. This variant looks up nothing from auth.uid(); the caller
-- passes the job's owning account_id directly, so it must be locked to
-- service_role only (mirrors 20260823161500_lock_down_active_list_rpcs.sql).
--
-- Called best-effort from handleFinalize: a failed/insufficient-credit charge
-- is logged by the Worker and never blocks or fails the candidate's
-- submission.
CREATE OR REPLACE FUNCTION public.charge_screening_completion_credit(
  p_account_id uuid,
  p_application_id uuid
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
  v_amount numeric := 50;
BEGIN
  IF p_account_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, 'No owning account';
    RETURN;
  END IF;

  -- Lock and read current balance to avoid race conditions.
  SELECT a.credits_balance
  INTO v_balance
  FROM public.accounts a
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

  UPDATE public.accounts
  SET credits_balance = ROUND(COALESCE(credits_balance, 0) - v_amount, 4)
  WHERE id = p_account_id
  RETURNING credits_balance INTO v_balance;

  INSERT INTO public.credit_transactions (account_id, type, amount, description)
  VALUES (
    p_account_id,
    'usage',
    -v_amount,
    CONCAT('Usage: video screening completed (application ', p_application_id, ')')
  );

  RETURN QUERY SELECT true, v_balance, 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.charge_screening_completion_credit(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_screening_completion_credit(uuid, uuid) TO service_role;
