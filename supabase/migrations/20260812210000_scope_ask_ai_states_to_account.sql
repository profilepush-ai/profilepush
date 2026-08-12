-- The "already asked" badge/gate for Ask AI (jobs and hotlist resume requests) was
-- computed platform-wide across every account, so once any account asked about a
-- job or consultant, every other account's Ask button was disabled for it too.
-- Scope both state functions to the calling account so accounts can ask
-- independently of one another.

DROP FUNCTION IF EXISTS public.get_pulse_asked_job_states();

CREATE FUNCTION public.get_pulse_asked_job_states(p_account_id uuid)
RETURNS TABLE (job_id uuid, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    requests.job_id,
    CASE
      WHEN BOOL_OR(requests.status = 'fulfilled' OR jobs.verification_status = 'verified') THEN 'verified'
      ELSE 'asked'
    END AS state
  FROM public.pulse_ask_ai_requests AS requests
  JOIN public.social_jobs AS jobs ON jobs.id = requests.job_id
  WHERE requests.status IN ('completed', 'fulfilled')
    AND requests.account_id = p_account_id
    AND EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.account_id = p_account_id
        AND am.user_id = auth.uid()
        AND am.status = 'active'
    )
  GROUP BY requests.job_id;
$$;

REVOKE ALL ON FUNCTION public.get_pulse_asked_job_states(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pulse_asked_job_states(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_hotlist_asked_states();

CREATE FUNCTION public.get_hotlist_asked_states(p_account_id uuid)
RETURNS TABLE (hotlist_id uuid, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    requests.hotlist_id,
    'asked'::text AS state
  FROM public.pulse_ask_ai_requests AS requests
  WHERE requests.hotlist_id IS NOT NULL
    AND requests.status = 'completed'
    AND requests.account_id = p_account_id
    AND EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.account_id = p_account_id
        AND am.user_id = auth.uid()
        AND am.status = 'active'
    )
  GROUP BY requests.hotlist_id;
$$;

REVOKE ALL ON FUNCTION public.get_hotlist_asked_states(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hotlist_asked_states(uuid) TO authenticated, service_role;
