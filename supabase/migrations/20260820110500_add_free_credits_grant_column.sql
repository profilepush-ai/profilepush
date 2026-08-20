-- Idempotency marker for the one-time 500-credit grant (never resets, unlike
-- the old monthly refresh_free_plan_credits model this replaces).
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS free_credits_granted_at timestamptz;
