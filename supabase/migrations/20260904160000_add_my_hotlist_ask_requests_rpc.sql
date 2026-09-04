-- pulse_ask_ai_requests is locked to service_role only (no client SELECT),
-- so the new Tracker page needs a narrow SECURITY DEFINER RPC to let a
-- recruiter see their own sent Hotlist "AI Request" outreach.

CREATE OR REPLACE FUNCTION public.get_my_hotlist_ask_requests()
RETURNS TABLE (
  id uuid,
  hotlist_id uuid,
  role_title text,
  candidate_name text,
  company_name text,
  status text,
  created_at timestamptz
)
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

  SELECT am.account_id INTO v_account_id
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account membership found';
  END IF;

  RETURN QUERY
  SELECT
    r.request_id,
    r.hotlist_id,
    sh.role_title,
    sh.candidate_name,
    sh.bench_sales_company_name,
    r.status,
    r.created_at
  FROM public.pulse_ask_ai_requests r
  JOIN public.social_hotlist sh ON sh.id = r.hotlist_id
  WHERE r.account_id = v_account_id AND r.hotlist_id IS NOT NULL
  ORDER BY r.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_hotlist_ask_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_hotlist_ask_requests() TO authenticated;
