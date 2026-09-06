-- Replace the free-plan-only download gate with a flat 50-contacts-per-
-- rolling-24h cap that applies to every account, paid or free. The prior
-- design (50/download + 500 lifetime, but only for free accounts — paid
-- accounts were fully exempt) left an open door: since the per-email credit
-- charge was removed in 20260906090000's companion frontend change, a paid
-- account could otherwise download the entire Active List (vendors +
-- recruiters) in one sitting with nothing to stop it. A rolling window
-- (not "resets at UTC midnight") closes the trivial "wait for the reset,
-- download 50 more" bypass.
--
-- Shared by both ActiveListPage.tsx (direct RPC call) and the public
-- /it-staffing-vendor-list, /it-staffing-bench-sales-recruiters-list pages
-- (via the active-list edge function, which forwards the caller's own JWT
-- so auth.uid() still resolves) — same account-wide budget either way.
-- Return shape changed (dropped is_free_plan, renamed lifetime_downloaded to
-- downloaded_today) — CREATE OR REPLACE can't change a function's OUT
-- parameters, so the old signature must be dropped first.
DROP FUNCTION IF EXISTS public.check_and_log_active_list_download(integer, text);

CREATE FUNCTION public.check_and_log_active_list_download(
  p_requested_count integer,
  p_download_type text
)
RETURNS TABLE (allowed_count integer, downloaded_today integer, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_used integer;
  v_remaining integer;
  v_allowed integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT 0, 0, 'Unauthorized'::text; RETURN;
  END IF;
  IF p_requested_count IS NULL OR p_requested_count <= 0 THEN
    RETURN QUERY SELECT 0, 0, 'Invalid request'::text; RETURN;
  END IF;
  IF p_download_type IS NULL OR p_download_type NOT IN ('vendors', 'recruiters') THEN
    RETURN QUERY SELECT 0, 0, 'Invalid download type'::text; RETURN;
  END IF;

  SELECT am.account_id INTO v_account_id
  FROM public.account_members am
  WHERE am.user_id = auth.uid() AND am.status = 'active'
  ORDER BY am.created_at ASC LIMIT 1;

  IF v_account_id IS NULL THEN
    RETURN QUERY SELECT 0, 0, 'No active account membership found'::text; RETURN;
  END IF;

  -- Lock as a mutex before reading the rolling-window sum, same
  -- check-then-act race protection as the lifetime cap this replaces.
  PERFORM 1 FROM public.accounts WHERE id = v_account_id FOR UPDATE;

  SELECT COALESCE(SUM(d.count), 0) INTO v_used
  FROM public.active_list_downloads d
  WHERE d.account_id = v_account_id
    AND d.created_at >= now() - interval '24 hours';

  v_remaining := GREATEST(50 - v_used, 0);
  v_allowed := LEAST(p_requested_count, v_remaining);

  IF v_allowed > 0 THEN
    INSERT INTO public.active_list_downloads (account_id, user_id, count, download_type)
    VALUES (v_account_id, auth.uid(), v_allowed, p_download_type);
  END IF;

  RETURN QUERY SELECT
    v_allowed,
    v_used + v_allowed,
    CASE
      WHEN v_allowed = 0 THEN 'You''ve reached today''s 50-contact download limit. Try again later.'
      WHEN v_allowed < p_requested_count THEN format('Daily limit: only %s of %s contacts could be included today.', v_allowed, p_requested_count)
      ELSE 'ok'
    END::text;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_log_active_list_download(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_log_active_list_download(integer, text) TO authenticated;
