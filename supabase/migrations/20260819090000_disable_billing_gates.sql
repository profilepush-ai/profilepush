-- Disable the credits/paywall model "for now" so the platform runs free.
-- This is a deliberate DISABLE, not a delete: accounts.credits_balance,
-- credit_transactions, subscriptions, and all Razorpay billing infra stay
-- in place and dormant. Every enforcement choke point below is swapped for
-- a permissive body while keeping its exact original signature (so grants
-- survive a CREATE OR REPLACE). To re-enable, restore each function's body
-- from the migration named in its comment and flip BILLING_GATES_ENABLED
-- back to true in src/lib/feature-gates.ts and
-- supabase/functions/_shared/usage-limits.ts.

-- Original body: supabase/migrations/20260705051919_add_credit_guard_rpc.sql
-- Called by 14 edge functions before paid AI/search operations; always
-- passing here neutralizes all of them with no per-function edits.
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
  SELECT true;
$$;

COMMENT ON FUNCTION check_credit_balance(uuid, numeric) IS
  'Billing gates disabled 2026-08-19. Original body: migration 20260705051919_add_credit_guard_rpc.sql. Restore that body to re-enable.';

-- Original body: supabase/migrations/20260801173500_add_consume_feature_credit_rpc.sql
-- Always succeeds without touching accounts.credits_balance or
-- credit_transactions. Return shape (success, new_balance, message) is
-- read by src/pages/PulsePage.tsx and supabase/functions/ask-ai-vendor-email.
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT true, COALESCE((SELECT a.credits_balance FROM accounts a WHERE a.id = p_account_id), 0)::numeric, 'ok'::text;
$$;

COMMENT ON FUNCTION public.consume_feature_credit(uuid, numeric, text, jsonb) IS
  'Billing gates disabled 2026-08-19. Original body: migration 20260801173500_add_consume_feature_credit_rpc.sql. Restore that body to re-enable.';

-- Original body: supabase/migrations/20260609114221_add_credits_system.sql
-- No-op so balances don't drift negative once nothing else decrements them
-- gracefully. api_usage_log still records real cost for telemetry.
CREATE OR REPLACE FUNCTION deduct_credits_on_usage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION deduct_credits_on_usage() IS
  'Billing gates disabled 2026-08-19. Original body: migration 20260609114221_add_credits_system.sql. Restore that body to re-enable.';
