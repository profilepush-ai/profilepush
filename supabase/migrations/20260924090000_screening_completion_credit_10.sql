-- A completed video screening costs 10 credits, not 50.
--
-- 50 was set before anything had run through the flow. Only two screenings
-- have ever completed, so there is no pricing history to preserve and no
-- account whose balance was planned around the old number.
--
-- Everything else about the charge is deliberate and unchanged: it is taken
-- from the account that owns the job (the vendor who asked for the
-- screening), it fires only on /finalize once the recording is stored, and
-- the caller treats failure as best-effort — a candidate's submission is
-- never rejected because the vendor is out of credits.

create or replace function public.charge_screening_completion_credit(
  p_account_id uuid,
  p_application_id uuid
)
returns table(success boolean, new_balance numeric, message text)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_balance numeric;
  v_amount numeric := 10;
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
$function$;
