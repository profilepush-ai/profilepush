-- Dashboard rebuilt around the two real personas (confirmed with the user,
-- not assumed): VENDOR (posts Jobs, requests consultants from Hotlist) and
-- RECRUITER/bench sales (posts Hotlist, applies to Jobs with consultants).
-- Replaces get_account_jobs_funnel_trend/get_account_hotlist_funnel_trend
-- (kind-based) with get_account_vendor_activity/get_account_recruiter_activity
-- (persona-based) — same account can have activity in both, shown as two
-- panels rather than gated by an account "type".
--
-- Two things fixed here that were wrong in the kind-based version:
-- 1. Active List download_type was mapped backwards: 'vendors' contacts
--    (companies with job requirements) is what a RECRUITER downloads to
--    find new companies to pitch consultants to; 'recruiters' contacts
--    (people with consultants) is what a VENDOR downloads to source
--    candidates. Swapped.
-- 2. A recruiter's "AI Submit" click takes one of TWO different backend
--    paths depending on the target job: submit_job_application ->
--    job_applications for jobs someone posted via /posts, or
--    ask-ai-vendor-email -> pulse_ask_ai_requests for scraped jobs (the
--    majority of jobs on the platform). The previous version only counted
--    the first, undercounting real submission volume badly. Both are now
--    combined into one "reached_out" total, with their different outcome
--    shapes (screening/qualified vs. email delivered) reported separately
--    rather than forced into one linear funnel that would misrepresent
--    what each number means.
CREATE OR REPLACE FUNCTION public.get_account_vendor_activity(p_days integer DEFAULT 7)
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
  applications AS (
    SELECT ja.status, ja.created_at FROM public.job_applications ja
    JOIN my_jobs j ON j.id = ja.social_job_id
    WHERE ja.created_at >= v_since
  ),
  previews AS (
    SELECT a.created_at FROM public.pulse_lead_actions a
    JOIN my_jobs j ON j.id::text = a.lead_id
    WHERE a.action_type = 'post_content_viewed' AND a.created_at >= v_since
  ),
  -- Hotlist requests I (this vendor) sent to OTHER accounts' consultants.
  sent_requests AS (
    SELECT r.status, r.created_at FROM public.pulse_ask_ai_requests r
    WHERE r.account_id = v_account_id AND r.hotlist_id IS NOT NULL AND r.created_at >= v_since
  ),
  -- Job-kind threads I own (applicants chatting about my post) + hotlist
  -- threads I started (I'm the participant, since the recruiter owns the
  -- hotlist post).
  conversations AS (
    SELECT created_at FROM public.post_chat_threads
    WHERE (post_kind = 'job' AND owner_account_id = v_account_id)
       OR (post_kind = 'hotlist' AND participant_account_id = v_account_id)
    AND created_at >= v_since
  ),
  -- 'recruiters' contacts (people who have consultants) — what a vendor
  -- downloads to source candidates.
  contacts_downloaded AS (
    SELECT count(*)::integer AS n FROM public.active_list_downloads
    WHERE account_id = v_account_id AND download_type = 'recruiters' AND created_at >= v_since
  ),
  days AS (
    SELECT d.day FROM generate_series(v_since, date_trunc('day', now()), interval '1 day') AS d(day)
  ),
  daily_previews AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM previews GROUP BY 1),
  daily_apps AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM applications GROUP BY 1),
  daily_requests AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM sent_requests GROUP BY 1)
  SELECT jsonb_build_object(
    'jobs_received_funnel', jsonb_build_object(
      'posted', (SELECT count(*) FROM my_jobs WHERE created_at >= v_since),
      'previewed', (SELECT count(*) FROM previews),
      'applied', (SELECT count(*) FROM applications),
      'screening_completed', (SELECT count(*) FROM applications WHERE status NOT IN ('submitted', 'screening_sent')),
      'qualified', (SELECT count(*) FROM applications WHERE status IN ('qualified', 'shortlisted')),
      'rejected', (SELECT count(*) FROM applications WHERE status = 'rejected')
    ),
    'hotlist_sent_funnel', jsonb_build_object(
      'requested', (SELECT count(*) FROM sent_requests),
      'fulfilled', (SELECT count(*) FROM sent_requests WHERE status = 'completed')
    ),
    'conversations', (SELECT count(*) FROM conversations),
    'contacts_downloaded', (SELECT n FROM contacts_downloaded),
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(days.day, 'YYYY-MM-DD'),
        'previews', coalesce(dp.n, 0),
        'applications', coalesce(da.n, 0),
        'requests', coalesce(dr.n, 0)
      ) ORDER BY days.day), '[]'::jsonb)
      FROM days
      LEFT JOIN daily_previews dp ON dp.day = days.day
      LEFT JOIN daily_apps da ON da.day = days.day
      LEFT JOIN daily_requests dr ON dr.day = days.day
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_vendor_activity(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_vendor_activity(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_account_recruiter_activity(p_days integer DEFAULT 7)
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
  -- "AI Submit" on a job I don't own takes one of two backend paths
  -- depending on whether that job was self-posted or scraped — combined
  -- here since both represent the exact same user intent.
  submitted_via_application AS (
    SELECT status, created_at FROM public.job_applications
    WHERE created_by_account_id = v_account_id AND created_at >= v_since
  ),
  submitted_via_outreach AS (
    SELECT status, created_at FROM public.pulse_ask_ai_requests
    WHERE account_id = v_account_id AND job_id IS NOT NULL AND created_at >= v_since
  ),
  -- Hotlist threads I own (vendors chatting about my consultant) + job
  -- threads I started (I'm the participant, since the vendor owns the job).
  conversations AS (
    SELECT created_at FROM public.vendor_conversations
    WHERE account_id = v_account_id AND created_at >= v_since
    UNION ALL
    SELECT created_at FROM public.post_chat_threads
    WHERE (post_kind = 'hotlist' AND owner_account_id = v_account_id)
       OR (post_kind = 'job' AND participant_account_id = v_account_id)
    AND created_at >= v_since
  ),
  -- 'vendors' contacts (companies with job requirements) — what a
  -- recruiter downloads to find new companies to pitch consultants to.
  contacts_downloaded AS (
    SELECT count(*)::integer AS n FROM public.active_list_downloads
    WHERE account_id = v_account_id AND download_type = 'vendors' AND created_at >= v_since
  ),
  days AS (
    SELECT d.day FROM generate_series(v_since, date_trunc('day', now()), interval '1 day') AS d(day)
  ),
  daily_previews AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM received_previews GROUP BY 1),
  daily_hotlist_requests AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM received_requests GROUP BY 1),
  daily_via_app AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM submitted_via_application GROUP BY 1),
  daily_via_outreach AS (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM submitted_via_outreach GROUP BY 1)
  SELECT jsonb_build_object(
    'hotlist_received_funnel', jsonb_build_object(
      'posted', (SELECT count(*) FROM my_hotlist WHERE created_at >= v_since),
      'previewed', (SELECT count(*) FROM received_previews),
      'requested', (SELECT count(*) FROM received_requests),
      'fulfilled', (SELECT count(*) FROM received_requests WHERE status = 'completed')
    ),
    'jobs_applying_funnel', jsonb_build_object(
      'reached_out', (SELECT count(*) FROM submitted_via_application) + (SELECT count(*) FROM submitted_via_outreach),
      'progressed', (SELECT count(*) FROM submitted_via_application WHERE status NOT IN ('submitted', 'screening_sent'))
        + (SELECT count(*) FROM submitted_via_outreach WHERE status = 'completed'),
      'qualified', (SELECT count(*) FROM submitted_via_application WHERE status IN ('qualified', 'shortlisted')),
      -- Breakdown by mechanism, since the two paths mean different things.
      'via_submission_total', (SELECT count(*) FROM submitted_via_application),
      'via_submission_screening_completed', (SELECT count(*) FROM submitted_via_application WHERE status NOT IN ('submitted', 'screening_sent')),
      'via_outreach_total', (SELECT count(*) FROM submitted_via_outreach),
      'via_outreach_delivered', (SELECT count(*) FROM submitted_via_outreach WHERE status = 'completed')
    ),
    'conversations', (SELECT count(*) FROM conversations),
    'contacts_downloaded', (SELECT n FROM contacts_downloaded),
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(days.day, 'YYYY-MM-DD'),
        'previews', coalesce(dp.n, 0),
        'requests', coalesce(dhr.n, 0),
        'submitted', coalesce(dva.n, 0) + coalesce(dvo.n, 0)
      ) ORDER BY days.day), '[]'::jsonb)
      FROM days
      LEFT JOIN daily_previews dp ON dp.day = days.day
      LEFT JOIN daily_hotlist_requests dhr ON dhr.day = days.day
      LEFT JOIN daily_via_app dva ON dva.day = days.day
      LEFT JOIN daily_via_outreach dvo ON dvo.day = days.day
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_recruiter_activity(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_recruiter_activity(integer) TO authenticated;

-- Superseded by the two persona-based RPCs above.
DROP FUNCTION IF EXISTS public.get_account_jobs_funnel_trend(integer);
DROP FUNCTION IF EXISTS public.get_account_hotlist_funnel_trend(integer);
