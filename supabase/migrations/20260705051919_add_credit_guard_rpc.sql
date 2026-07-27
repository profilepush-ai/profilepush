-- Returns true if the account has at least p_min_balance credits available.
-- Edge functions call this before executing costly LLM / scraping operations.
CREATE OR REPLACE FUNCTION check_credit_balance(
  p_account_id  uuid,
  p_min_balance numeric DEFAULT 0.001
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(credits_balance, 0) >= p_min_balance
  FROM   accounts
  WHERE  id = p_account_id;
$$;

-- Grant execute to the service role used by edge functions
GRANT EXECUTE ON FUNCTION check_credit_balance(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION check_credit_balance(uuid, numeric) TO authenticated;
