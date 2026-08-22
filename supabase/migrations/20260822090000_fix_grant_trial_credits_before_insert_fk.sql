-- 20260820111500 converted the signup credit grant to a BEFORE INSERT
-- trigger on accounts so it could stamp NEW.credits_balance /
-- NEW.free_credits_granted_at directly, but left the credit_transactions
-- ledger insert (INSERT ... VALUES (NEW.id, ...)) inside that same BEFORE
-- trigger. NEW.id having a value (via the gen_random_uuid() column
-- default, resolved before BEFORE ROW triggers run) is not the same as the
-- accounts row existing in the table — a BEFORE trigger fires before the
-- row is actually inserted, so credit_transactions.account_id's FK to
-- accounts.id always failed, silently breaking every new account creation
-- (any signup method) since that migration went live. Confirmed via
-- production: no accounts row has been created successfully since.
--
-- Fix: keep the BEFORE trigger for the NEW field stamps (no DB write, so
-- it's safe pre-insert), move the ledger insert to a separate AFTER INSERT
-- trigger, where the accounts row is guaranteed to exist for the FK check.

CREATE OR REPLACE FUNCTION public.grant_trial_credits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.credits_balance := 500;
  NEW.free_credits_granted_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_trial_credits_grant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.credit_transactions (account_id, type, amount, description)
  VALUES (NEW.id, 'grant', 500, 'Free signup credits');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_trial_credits ON public.accounts;
CREATE TRIGGER trg_grant_trial_credits
  BEFORE INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.grant_trial_credits();

DROP TRIGGER IF EXISTS trg_log_trial_credits_grant ON public.accounts;
CREATE TRIGGER trg_log_trial_credits_grant
  AFTER INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.log_trial_credits_grant();
