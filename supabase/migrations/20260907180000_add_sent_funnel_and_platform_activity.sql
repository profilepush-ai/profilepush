-- Dashboard feedback: the previous version only reflected /posts activity
-- (jobs/hotlist I POSTED, receiving previews/applications). It was missing
-- everything from /feed (revealing contacts, viewing breakdowns on OTHER
-- people's leads), /tracker + /inbox (my own OUTBOUND submissions/requests
-- and their replies), and /active-list (contact downloads). This migration
-- extends both RPCs to add a second "sent" (outbound) funnel alongside the
-- existing "received" (inbound) one, plus conversation and active-list
-- counts, and adds "revealed"/"submitted" (or "requested") to the daily
-- trend series so the chart reflects outbound activity too.
--
-- job_applications has TWO distinct account_id-shaped columns that are easy
-- to confuse: social_jobs.created_by_account_id (the job POSTER) vs
-- job_applications.created_by_account_id (the recruiter who SUBMITTED a
-- consultant to someone else's job, per the migration comment in
-- 20260903110000_create_job_applications.sql). The existing "received"
-- funnel already correctly joins through the former; the new "sent" funnel
-- below filters directly on the latter.
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
  received_apps AS (
    SELECT ja.status, ja.created_at FROM public.job_applications ja
    JOIN my_jobs j ON j.id = ja.social_job_id
    WHERE ja.created_at >= v_since
  ),
  received_previews AS (
    SELECT a.created_at FROM public.pulse_lead_actions a
    JOIN my_jobs j ON j.id::text = a.lead_id
    WHERE a.action_type = 'post_content_viewed' AND a.created_at >= v_since
  ),
  -- Outbound: leads I (this account) revealed/viewed-breakdown-on, on OTHER
  -- accounts' job posts (found via /feed), disambiguated from hotlist leads
  -- by checking existence in social_jobs.
  sent_revealed AS (
    SELECT a.created_at FROM public.pulse_lead_actions a
    WHERE a.account_id = v_account_id AND a.action_type = 'revealed' AND a.created_at >= v_since
      AND EXISTS (SELECT 1 FROM public.social_jobs sj WHERE sj.id::text = a.lead_id)
  ),
  sent_breakdown AS (
    SELECT a.created_at FROM public.pulse_lead_actions a
    WHERE a.account_id = v_account_id AND a.action_type = 'breakdown' AND a.created_at >= v_since
      AND EXISTS (SELECT 1 FROM public.social_jobs sj WHERE sj.id::text = a.lead_id)
  ),
  -- My own bench consultants submitted to someone else's job post.
  sent_apps AS (
    SELECT ja.status, ja.created_at FROM public.job_applications ja
    WHERE ja.created_by_account_id = v_account_id AND ja.created_at >= v_since
  ),
  conversations AS (
    SELECT created_at FROM public.vendor_conversations
    WHERE account_id = v_account_id AND created_at >= v_since
    UNION ALL
    SELECT created_at FROM public.post_chat_threads
    WHERE post_kind = 'job' AND (owner_account_id = v_account_id OR participant_account_id = v_account_id)
      AND created_at >= v_since
  ),
  active_list_jobs_side AS (
    SELECT count(*)::integer AS n FROM public.active_list_downloads
    WHERE account_id = v_account_id AND download_type = 'vendors' AND created_at >= v_since
  ),
  days AS (
    SELECT d.day FROM generate_series(v_since, date_trunc('day', now()), interval '1 day') AS d(day)
  ),
  daily_previews AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM received_previews GROUP BY 1),
  daily_apps AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM received_apps GROUP BY 1),
  daily_revealed AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM sent_revealed GROUP BY 1),
  daily_sent_apps AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM sent_apps GROUP BY 1)
  SELECT jsonb_build_object(
    'received_funnel', jsonb_build_object(
      'posted', (SELECT count(*) FROM my_jobs WHERE created_at >= v_since),
      'previewed', (SELECT count(*) FROM received_previews),
      'applied', (SELECT count(*) FROM received_apps),
      'screening_completed', (SELECT count(*) FROM received_apps WHERE status NOT IN ('submitted', 'screening_sent')),
      'qualified', (SELECT count(*) FROM received_apps WHERE status IN ('qualified', 'shortlisted')),
      'rejected', (SELECT count(*) FROM received_apps WHERE status = 'rejected')
    ),
    'sent_funnel', jsonb_build_object(
      'revealed', (SELECT count(*) FROM sent_revealed),
      'breakdown_viewed', (SELECT count(*) FROM sent_breakdown),
      'submitted', (SELECT count(*) FROM sent_apps),
      'screening_completed', (SELECT count(*) FROM sent_apps WHERE status NOT IN ('submitted', 'screening_sent')),
      'qualified', (SELECT count(*) FROM sent_apps WHERE status IN ('qualified', 'shortlisted'))
    ),
    'conversations', (SELECT count(*) FROM conversations),
    'active_list_downloaded', (SELECT n FROM active_list_jobs_side),
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(days.day, 'YYYY-MM-DD'),
        'previews', coalesce(dp.n, 0),
        'applications', coalesce(da.n, 0),
        'revealed', coalesce(dr.n, 0),
        'submitted', coalesce(ds.n, 0)
      ) ORDER BY days.day), '[]'::jsonb)
      FROM days
      LEFT JOIN daily_previews dp ON dp.day = days.day
      LEFT JOIN daily_apps da ON da.day = days.day
      LEFT JOIN daily_revealed dr ON dr.day = days.day
      LEFT JOIN daily_sent_apps ds ON ds.day = days.day
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_jobs_funnel_trend(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_jobs_funnel_trend(integer) TO authenticated;

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
  received_requests AS (
    SELECT r.status, r.created_at FROM public.pulse_ask_ai_requests r
    JOIN my_hotlist h ON h.id = r.hotlist_id
    WHERE r.created_at >= v_since
  ),
  received_previews AS (
    SELECT a.created_at FROM public.pulse_lead_actions a
    JOIN my_hotlist h ON h.id::text = a.lead_id
    WHERE a.action_type = 'post_content_viewed' AND a.created_at >= v_since
  ),
  -- Outbound: leads I (this account) revealed/viewed-breakdown-on, on OTHER
  -- accounts' hotlist posts, disambiguated by existence in social_hotlist.
  sent_revealed AS (
    SELECT a.created_at FROM public.pulse_lead_actions a
    WHERE a.account_id = v_account_id AND a.action_type = 'revealed' AND a.created_at >= v_since
      AND EXISTS (SELECT 1 FROM public.social_hotlist sh WHERE sh.id::text = a.lead_id)
  ),
  sent_breakdown AS (
    SELECT a.created_at FROM public.pulse_lead_actions a
    WHERE a.account_id = v_account_id AND a.action_type = 'breakdown' AND a.created_at >= v_since
      AND EXISTS (SELECT 1 FROM public.social_hotlist sh WHERE sh.id::text = a.lead_id)
  ),
  -- My own Ask-AI resume requests sent on someone else's hotlist post.
  sent_requests AS (
    SELECT r.status, r.created_at FROM public.pulse_ask_ai_requests r
    WHERE r.account_id = v_account_id AND r.hotlist_id IS NOT NULL AND r.created_at >= v_since
  ),
  conversations AS (
    SELECT created_at FROM public.post_chat_threads
    WHERE post_kind = 'hotlist' AND (owner_account_id = v_account_id OR participant_account_id = v_account_id)
      AND created_at >= v_since
  ),
  active_list_hotlist_side AS (
    SELECT count(*)::integer AS n FROM public.active_list_downloads
    WHERE account_id = v_account_id AND download_type = 'recruiters' AND created_at >= v_since
  ),
  days AS (
    SELECT d.day FROM generate_series(v_since, date_trunc('day', now()), interval '1 day') AS d(day)
  ),
  daily_previews AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM received_previews GROUP BY 1),
  daily_requests AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM received_requests GROUP BY 1),
  daily_revealed AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM sent_revealed GROUP BY 1),
  daily_sent_requests AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM sent_requests GROUP BY 1)
  SELECT jsonb_build_object(
    'received_funnel', jsonb_build_object(
      'posted', (SELECT count(*) FROM my_hotlist WHERE created_at >= v_since),
      'previewed', (SELECT count(*) FROM received_previews),
      'requested', (SELECT count(*) FROM received_requests),
      'fulfilled', (SELECT count(*) FROM received_requests WHERE status = 'completed')
    ),
    'sent_funnel', jsonb_build_object(
      'revealed', (SELECT count(*) FROM sent_revealed),
      'breakdown_viewed', (SELECT count(*) FROM sent_breakdown),
      'requested', (SELECT count(*) FROM sent_requests),
      'fulfilled', (SELECT count(*) FROM sent_requests WHERE status = 'completed')
    ),
    'conversations', (SELECT count(*) FROM conversations),
    'active_list_downloaded', (SELECT n FROM active_list_hotlist_side),
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(days.day, 'YYYY-MM-DD'),
        'previews', coalesce(dp.n, 0),
        'requests', coalesce(dreq.n, 0),
        'revealed', coalesce(dr.n, 0),
        'sent_requests', coalesce(dsr.n, 0)
      ) ORDER BY days.day), '[]'::jsonb)
      FROM days
      LEFT JOIN daily_previews dp ON dp.day = days.day
      LEFT JOIN daily_requests dreq ON dreq.day = days.day
      LEFT JOIN daily_revealed dr ON dr.day = days.day
      LEFT JOIN daily_sent_requests dsr ON dsr.day = days.day
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_hotlist_funnel_trend(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_hotlist_funnel_trend(integer) TO authenticated;
