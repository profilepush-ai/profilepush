-- One-time, additive, idempotent grant of 500 credits to every existing
-- account (94 accounts as of writing, balances ranging $0.01-$49.45 from
-- historical usage — additive so nobody's existing balance is clobbered).
-- Safe to re-run: the free_credits_granted_at IS NULL guard makes a second
-- run a true no-op.
WITH granted AS (
  UPDATE public.accounts
  SET credits_balance = COALESCE(credits_balance, 0) + 500,
      free_credits_granted_at = now()
  WHERE free_credits_granted_at IS NULL
  RETURNING id
)
INSERT INTO public.credit_transactions (account_id, type, amount, description)
SELECT id, 'grant', 500, 'One-time free credits grant (2026-08-20 revival)'
FROM granted;
