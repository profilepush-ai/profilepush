-- Global account-level persona (Vendor posts Jobs + requests Hotlist resumes;
-- Bench Sales posts Hotlist + applies to Jobs) that drives a hard onboarding
-- gate, a header switcher, and per-page filtering across the app. Nullable
-- with no default so every pre-existing account is naturally caught by the
-- "active_persona IS NULL" gate on next login.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS active_persona text CHECK (active_persona IN ('vendor', 'bench_sales'));

-- SECURITY DEFINER because accounts' own update_own_account RLS policy only
-- allows owner_id = auth.uid() — a non-owner team member flipping the
-- switcher would silently fail under a direct client-side update. Resolves
-- the account via account_members instead, matching every other
-- account-scoped RPC in this codebase (get_account_vendor_activity, etc.).
CREATE OR REPLACE FUNCTION public.set_active_persona(p_persona text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_persona NOT IN ('vendor', 'bench_sales') THEN
    RAISE EXCEPTION 'Invalid persona';
  END IF;

  SELECT am.account_id INTO v_account_id
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account membership found';
  END IF;

  UPDATE public.accounts SET active_persona = p_persona WHERE id = v_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_active_persona(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_persona(text) TO authenticated;
