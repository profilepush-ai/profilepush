CREATE TABLE IF NOT EXISTS public.pulse_ask_ai_requests (
  request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.social_jobs(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('processing', 'charged', 'completed', 'failed', 'refunded')),
  missing_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  charged_amount numeric(12, 4) NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pulse_ask_ai_requests_account_created_idx
  ON public.pulse_ask_ai_requests (account_id, created_at DESC);

ALTER TABLE public.pulse_ask_ai_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pulse_ask_ai_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pulse_ask_ai_requests TO service_role;

CREATE OR REPLACE FUNCTION public.refund_feature_credit(
  p_account_id uuid,
  p_amount numeric,
  p_feature text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_balance numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_amount := ROUND(COALESCE(p_amount, 0), 4);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid refund amount';
  END IF;

  UPDATE public.accounts
  SET credits_balance = ROUND(COALESCE(credits_balance, 0) + v_amount, 4)
  WHERE id = p_account_id
  RETURNING credits_balance INTO v_balance;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  INSERT INTO public.credit_transactions (account_id, type, amount, description)
  VALUES (
    p_account_id,
    'refund',
    v_amount,
    CONCAT('Pulse refund: ', COALESCE(NULLIF(TRIM(p_feature), ''), 'feature action'))
  );

  RETURN v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_feature_credit(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_feature_credit(uuid, numeric, text) TO service_role;