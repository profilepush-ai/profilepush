-- Free-account Active List download limits: 50 contacts per download,
-- 500 contacts lifetime. Paid accounts (active subscription) are exempt.
--
-- Independent of the credits/billing system on purpose: consume_feature_credit
-- is live again (restored in 20260820112000_restore_consume_feature_credit.sql
-- after being briefly stubbed in 20260819090000_disable_billing_gates.sql) and
-- already gates ActiveListPage.tsx's bulk export at 0.25 credit/email, but a
-- fresh free account's 500 signup credits buy ~2000 emails through that path
-- alone — far looser than this new lifetime cap. This is a separate,
-- additional gate, not a replacement.

-- Append-only log, mirrors credit_transactions' shape/RLS/index convention
-- (supabase/migrations/20260609114221_add_credits_system.sql). The lifetime
-- total is SUM(count) over a free account's rows here, not a running counter
-- column, so there's an audit trail of individual downloads.
CREATE TABLE public.active_list_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  count integer NOT NULL CHECK (count > 0 AND count <= 50),
  download_type text NOT NULL CHECK (download_type IN ('vendors', 'recruiters')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.active_list_downloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_insert_active_list_downloads" ON public.active_list_downloads FOR INSERT
  TO service_role WITH CHECK (true);

CREATE POLICY "select_own_active_list_downloads" ON public.active_list_downloads FOR SELECT
  TO authenticated USING (
    account_id IN (SELECT account_id FROM account_members WHERE user_id = auth.uid() AND status = 'active')
  );

CREATE INDEX idx_active_list_downloads_account ON public.active_list_downloads (account_id, created_at DESC);

-- Enforcement RPC. Two security-critical choices, both deliberate:
--
-- 1. No p_account_id parameter — it's derived from auth.uid() via
--    account_members instead, mirroring create_user_job_post/
--    create_user_hotlist_post (20260819110000_add_user_post_rpcs.sql).
--    Taking account_id as a caller-supplied argument on a function grantable
--    to `authenticated` would be an IDOR: any signed-in user could pass a
--    different account's UUID and burn that account's budget or read its
--    status. ORDER BY am.created_at ASC LIMIT 1 handles the (rare) case of a
--    user holding more than one active membership, same as the precedent.
--
-- 2. LANGUAGE plpgsql with `SELECT ... FOR UPDATE` on the accounts row as a
--    mutex before reading SUM(count) — not just a single "atomic-looking"
--    statement. Two concurrent calls for the same account would otherwise
--    both read the same pre-commit sum and both think they have room
--    (check-then-act race); statement-level atomicity doesn't prevent that
--    across separate transactions. This is the same locking pattern (and the
--    only other precedent for it in this codebase) that
--    consume_feature_credit uses to protect credits_balance. Paid accounts
--    are checked and returned before the lock, so they never contend for it.
CREATE OR REPLACE FUNCTION public.check_and_log_active_list_download(
  p_requested_count integer,
  p_download_type text
)
RETURNS TABLE (allowed_count integer, is_free_plan boolean, lifetime_downloaded integer, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_is_paid boolean;
  v_lifetime integer;
  v_remaining integer;
  v_allowed integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT 0, false, 0, 'Unauthorized'::text; RETURN;
  END IF;
  IF p_requested_count IS NULL OR p_requested_count <= 0 THEN
    RETURN QUERY SELECT 0, false, 0, 'Invalid request'::text; RETURN;
  END IF;
  IF p_download_type IS NULL OR p_download_type NOT IN ('vendors', 'recruiters') THEN
    RETURN QUERY SELECT 0, false, 0, 'Invalid download type'::text; RETURN;
  END IF;

  SELECT am.account_id INTO v_account_id
  FROM public.account_members am
  WHERE am.user_id = auth.uid() AND am.status = 'active'
  ORDER BY am.created_at ASC LIMIT 1;

  IF v_account_id IS NULL THEN
    RETURN QUERY SELECT 0, false, 0, 'No active account membership found'::text; RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.account_id = v_account_id AND s.status = 'active' AND COALESCE(s.plan_credits, 0) > 0
  ) INTO v_is_paid;

  IF v_is_paid THEN
    RETURN QUERY SELECT p_requested_count, false, 0, 'ok'::text; RETURN;
  END IF;

  PERFORM 1 FROM public.accounts WHERE id = v_account_id FOR UPDATE;

  SELECT COALESCE(SUM(d.count), 0) INTO v_lifetime
  FROM public.active_list_downloads d WHERE d.account_id = v_account_id;

  v_remaining := GREATEST(500 - v_lifetime, 0);
  v_allowed := LEAST(p_requested_count, 50, v_remaining);

  IF v_allowed > 0 THEN
    INSERT INTO public.active_list_downloads (account_id, user_id, count, download_type)
    VALUES (v_account_id, auth.uid(), v_allowed, p_download_type);
  END IF;

  RETURN QUERY SELECT
    v_allowed,
    true,
    v_lifetime + v_allowed,
    CASE
      WHEN v_allowed = 0 AND v_remaining = 0 THEN 'You have reached the free plan''s 500-contact lifetime download limit. Upgrade for unlimited downloads.'
      WHEN v_allowed = 0 THEN 'Download limit reached.'
      WHEN v_allowed < p_requested_count THEN format('Free plan limit: only %s of %s contacts could be included.', v_allowed, p_requested_count)
      ELSE 'ok'
    END::text;
END;
$$;

-- Explicit anon/authenticated names in the REVOKE, not just PUBLIC — this
-- project auto-grants EXECUTE to both at function-creation time regardless of
-- GRANT statements (confirmed in 20260823161500_lock_down_active_list_rpcs.sql
-- and 20260824090000_add_active_list_contact_count_rpcs.sql). A bare
-- `REVOKE ALL FROM PUBLIC` silently fails to lock this down.
REVOKE ALL ON FUNCTION public.check_and_log_active_list_download(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_log_active_list_download(integer, text) TO authenticated;
