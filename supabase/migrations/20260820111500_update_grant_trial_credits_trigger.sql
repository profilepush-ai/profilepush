-- Convert the signup grant from a $5.00 AFTER-INSERT ledger-only entry to a
-- 500-credit BEFORE-INSERT grant that also stamps the row itself, so new
-- signups are covered by the same free_credits_granted_at idempotency
-- column the backfill migration relies on (a BEFORE ROW trigger can still
-- see NEW.id here since column DEFAULTs, including gen_random_uuid(), are
-- evaluated before BEFORE ROW triggers run).

CREATE OR REPLACE FUNCTION public.grant_trial_credits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.credits_balance := 500;
  NEW.free_credits_granted_at := now();
  INSERT INTO public.credit_transactions (account_id, type, amount, description)
  VALUES (NEW.id, 'grant', 500, 'Free signup credits');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_trial_credits ON public.accounts;
CREATE TRIGGER trg_grant_trial_credits
  BEFORE INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.grant_trial_credits();

ALTER TABLE public.accounts ALTER COLUMN credits_balance SET DEFAULT 500;
