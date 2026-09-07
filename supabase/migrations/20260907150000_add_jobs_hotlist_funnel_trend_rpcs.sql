-- Dashboard (/pulse) redesign: two funnels (Jobs, Hotlist) with a
-- date-range selector and daily trend series for charting, replacing the
-- old fixed "today only" get_pulse_dashboard_stats snapshot. Same
-- auth.uid() -> account_members resolution as every other account-scoped
-- RPC (get_my_post_metrics, get_account_application_funnel).
--
-- Funnel stages are CUMULATIVE ("reached this stage or further"), not a
-- count of rows currently sitting in that exact status — job_applications.
-- status is overwritten in place (not an append-only event log), so a
-- naive per-status count would understate earlier stages every time an
-- application progresses. screening_completed therefore counts everything
-- that has left submitted/screening_sent (completed, qualified, shortlisted,
-- or rejected — rejecting an application implies a recruiter already
-- reviewed it, which in this product's flow means the screening step was
-- reached). Plain 'rejected' is reported separately as a terminal/drop-off
-- stat, not chained into the forward funnel, since it can occur at any
-- point and would otherwise make the funnel's percentages misleading.
CREATE OR REPLACE FUNCTION public.get_account_jobs_funnel_trend(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_since timestamptz;
  v_result jsonb;
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

  v_since := date_trunc('day', now()) - (GREATEST(1, LEAST(COALESCE(p_days, 7), 90)) - 1 || ' days')::interval;

  WITH my_jobs AS (
    SELECT id, created_at FROM public.social_jobs
    WHERE created_by_account_id = v_account_id AND post_source = 'user_post'
  ),
  apps AS (
    SELECT ja.status, ja.created_at FROM public.job_applications ja
    JOIN my_jobs j ON j.id = ja.social_job_id
    WHERE ja.created_at >= v_since
  ),
  previews AS (
    SELECT a.created_at FROM public.pulse_lead_actions a
    JOIN my_jobs j ON j.id::text = a.lead_id
    WHERE a.action_type = 'post_content_viewed' AND a.created_at >= v_since
  ),
  days AS (
    SELECT d.day FROM generate_series(v_since, date_trunc('day', now()), interval '1 day') AS d(day)
  ),
  daily_previews AS (
    SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM previews GROUP BY 1
  ),
  daily_apps AS (
    SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM apps GROUP BY 1
  )
  SELECT jsonb_build_object(
    'funnel', jsonb_build_object(
      'posted', (SELECT count(*) FROM my_jobs WHERE created_at >= v_since),
      'previewed', (SELECT count(*) FROM previews),
      'applied', (SELECT count(*) FROM apps),
      'screening_completed', (SELECT count(*) FROM apps WHERE status NOT IN ('submitted', 'screening_sent')),
      'qualified', (SELECT count(*) FROM apps WHERE status IN ('qualified', 'shortlisted')),
      'rejected', (SELECT count(*) FROM apps WHERE status = 'rejected')
    ),
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(days.day, 'YYYY-MM-DD'),
        'previews', coalesce(dp.n, 0),
        'applications', coalesce(da.n, 0)
      ) ORDER BY days.day), '[]'::jsonb)
      FROM days
      LEFT JOIN daily_previews dp ON dp.day = days.day
      LEFT JOIN daily_apps da ON da.day = days.day
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_jobs_funnel_trend(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_jobs_funnel_trend(integer) TO authenticated;

-- Hotlist side: no "screening" concept — a recruiter previews a listed
-- consultant, then optionally sends an Ask-AI request (resume ask), which
-- is eventually marked 'completed' once fulfilled.
CREATE OR REPLACE FUNCTION public.get_account_hotlist_funnel_trend(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_since timestamptz;
  v_result jsonb;
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

  v_since := date_trunc('day', now()) - (GREATEST(1, LEAST(COALESCE(p_days, 7), 90)) - 1 || ' days')::interval;

  WITH my_hotlist AS (
    SELECT id, created_at FROM public.social_hotlist
    WHERE created_by_account_id = v_account_id AND post_source = 'user_post'
  ),
  requests AS (
    SELECT r.status, r.created_at FROM public.pulse_ask_ai_requests r
    JOIN my_hotlist h ON h.id = r.hotlist_id
    WHERE r.created_at >= v_since
  ),
  previews AS (
    SELECT a.created_at FROM public.pulse_lead_actions a
    JOIN my_hotlist h ON h.id::text = a.lead_id
    WHERE a.action_type = 'post_content_viewed' AND a.created_at >= v_since
  ),
  days AS (
    SELECT d.day FROM generate_series(v_since, date_trunc('day', now()), interval '1 day') AS d(day)
  ),
  daily_previews AS (
    SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM previews GROUP BY 1
  ),
  daily_requests AS (
    SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM requests GROUP BY 1
  )
  SELECT jsonb_build_object(
    'funnel', jsonb_build_object(
      'posted', (SELECT count(*) FROM my_hotlist WHERE created_at >= v_since),
      'previewed', (SELECT count(*) FROM previews),
      'requested', (SELECT count(*) FROM requests),
      'fulfilled', (SELECT count(*) FROM requests WHERE status = 'completed')
    ),
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(days.day, 'YYYY-MM-DD'),
        'previews', coalesce(dp.n, 0),
        'requests', coalesce(dr.n, 0)
      ) ORDER BY days.day), '[]'::jsonb)
      FROM days
      LEFT JOIN daily_previews dp ON dp.day = days.day
      LEFT JOIN daily_requests dr ON dr.day = days.day
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_hotlist_funnel_trend(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_hotlist_funnel_trend(integer) TO authenticated;
