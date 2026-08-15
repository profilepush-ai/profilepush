-- 1. Close a pre-existing RLS gap: social_jobs currently lets ANY authenticated (and
-- even anonymous) request insert/update/delete ANY row (qual/with_check = true, left
-- over from its original migration). The ingestion pipeline (receive-social-job edge
-- function) writes via the service role and never needed these — tightening this is
-- also a prerequisite for the admin-only "hide from platform" feature below, since
-- otherwise any signed-in user could set hidden_at directly via the client SDK.
DROP POLICY IF EXISTS anon_insert_social_jobs ON public.social_jobs;
DROP POLICY IF EXISTS anon_update_social_jobs ON public.social_jobs;
DROP POLICY IF EXISTS anon_delete_social_jobs ON public.social_jobs;
DROP POLICY IF EXISTS anon_select_social_jobs ON public.social_jobs;

CREATE POLICY authenticated_read_social_jobs
  ON public.social_jobs FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.social_jobs TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.social_jobs FROM authenticated, anon;
REVOKE ALL ON public.social_jobs FROM anon;

-- 2. Per-user "ignore" (removes a lead from just that account's own feed).
ALTER TABLE public.pulse_lead_actions
  DROP CONSTRAINT IF EXISTS pulse_lead_actions_action_type_check;
ALTER TABLE public.pulse_lead_actions
  ADD CONSTRAINT pulse_lead_actions_action_type_check
  CHECK (action_type IN ('revealed', 'breakdown', 'post_content_viewed', 'ignored'));

-- 3. Platform-wide "hide" (admin spam moderation) — excluded from every account's feed.
ALTER TABLE public.social_jobs ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.social_hotlist ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_social_jobs_hidden_at ON public.social_jobs (hidden_at) WHERE hidden_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_hotlist_hidden_at ON public.social_hotlist (hidden_at) WHERE hidden_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_pulse_social_feed(
  p_since timestamptz,
  p_limit integer DEFAULT 5000
)
RETURNS TABLE (
  lead_id text,
  profile_id uuid,
  match_created_at timestamptz,
  final_average_score double precision,
  score_breakdown jsonb,
  platform text,
  posted_by_name text,
  poster_email text,
  poster_phone text,
  social_created_at timestamptz,
  posted_at timestamptz,
  job_title text,
  company_name text,
  location text,
  post_content text,
  extracted_role_normalized text,
  employment_type text,
  seniority_level text,
  salary_range text,
  extracted_skills text[],
  extracted_experience_years integer,
  extracted_visa_types text[],
  extracted_hourly_rate_min numeric,
  extracted_hourly_rate_max numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_matches AS (
    SELECT DISTINCT ON (r.job_id)
      r.job_id::text AS lead_id,
      r.profile_id,
      r.created_at AS match_created_at,
      r.final_average_score,
      r.score_breakdown
    FROM public.radar_match_results r
    WHERE r.job_source = 'social'
      AND r.created_at >= COALESCE(p_since, now() - interval '72 hours')
    ORDER BY r.job_id, r.created_at DESC
  )
  SELECT
    lm.lead_id,
    lm.profile_id,
    lm.match_created_at,
    lm.final_average_score,
    lm.score_breakdown,
    s.platform,
    s.posted_by_name,
    s.poster_email,
    s.poster_phone,
    s.created_at AS social_created_at,
    s.posted_at,
    s.job_title,
    s.company_name,
    s.location,
    s.post_content,
    s.extracted_role_normalized,
    s.employment_type,
    s.seniority_level,
    s.salary_range,
    CASE
      WHEN s.extracted_skills IS NULL THEN NULL
      WHEN jsonb_typeof(s.extracted_skills) = 'array' THEN array(SELECT jsonb_array_elements_text(s.extracted_skills))
      ELSE NULL
    END AS extracted_skills,
    s.extracted_experience_years,
    CASE
      WHEN s.extracted_visa_types IS NULL THEN NULL
      WHEN jsonb_typeof(s.extracted_visa_types) = 'array' THEN array(SELECT jsonb_array_elements_text(s.extracted_visa_types))
      ELSE NULL
    END AS extracted_visa_types,
    s.extracted_hourly_rate_min,
    s.extracted_hourly_rate_max
  FROM latest_matches lm
  JOIN public.social_jobs s ON s.id::text = lm.lead_id
  WHERE s.hidden_at IS NULL
  ORDER BY lm.match_created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5000), 10000));
$$;

CREATE OR REPLACE FUNCTION public.get_pulse_social_feed_page(
  p_since timestamptz,
  p_before_posted_at timestamptz DEFAULT NULL,
  p_before_lead_id text DEFAULT NULL,
  p_limit integer DEFAULT 1000
)
RETURNS TABLE (
  lead_id text,
  profile_id uuid,
  match_created_at timestamptz,
  final_average_score double precision,
  score_breakdown jsonb,
  platform text,
  posted_by_name text,
  poster_email text,
  poster_phone text,
  social_created_at timestamptz,
  posted_at timestamptz,
  effective_posted_at timestamptz,
  job_title text,
  company_name text,
  location text,
  post_content text,
  extracted_role_normalized text,
  employment_type text,
  seniority_level text,
  salary_range text,
  extracted_skills text[],
  extracted_experience_years integer,
  extracted_visa_types text[],
  extracted_hourly_rate_min numeric,
  extracted_hourly_rate_max numeric,
  role_title text,
  core_skills text[],
  years_experience numeric,
  visa_types text[],
  work_type text,
  locations text[],
  hourly_rate_min numeric,
  hourly_rate_max numeric,
  relocation_required boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_matches AS (
    SELECT DISTINCT ON (matches.job_id)
      matches.job_id::text AS lead_id,
      matches.profile_id,
      matches.created_at AS match_created_at,
      matches.final_average_score,
      matches.score_breakdown,
      matches.role_title,
      matches.core_skills,
      matches.years_experience,
      matches.visa_types,
      matches.work_type,
      matches.locations,
      matches.hourly_rate_min,
      matches.hourly_rate_max,
      matches.relocation_required
    FROM public.radar_match_results matches
    WHERE matches.job_source = 'social'
    ORDER BY matches.job_id, matches.created_at DESC
  ), feed_rows AS (
    SELECT
      latest.lead_id,
      latest.profile_id,
      latest.match_created_at,
      latest.final_average_score,
      latest.score_breakdown,
      social.platform,
      social.posted_by_name,
      social.poster_email,
      social.poster_phone,
      social.created_at AS social_created_at,
      social.posted_at,
      COALESCE(social.posted_at, social.created_at) AS effective_posted_at,
      social.job_title,
      social.company_name,
      social.location,
      social.post_content,
      social.extracted_role_normalized,
      social.employment_type,
      social.seniority_level,
      social.salary_range,
      CASE
        WHEN social.extracted_skills IS NULL THEN NULL
        WHEN jsonb_typeof(social.extracted_skills) = 'array' THEN array(SELECT jsonb_array_elements_text(social.extracted_skills))
        ELSE NULL
      END AS extracted_skills,
      social.extracted_experience_years,
      CASE
        WHEN social.extracted_visa_types IS NULL THEN NULL
        WHEN jsonb_typeof(social.extracted_visa_types) = 'array' THEN array(SELECT jsonb_array_elements_text(social.extracted_visa_types))
        ELSE NULL
      END AS extracted_visa_types,
      social.extracted_hourly_rate_min,
      social.extracted_hourly_rate_max,
      latest.role_title,
      latest.core_skills,
      latest.years_experience,
      latest.visa_types,
      latest.work_type,
      latest.locations,
      latest.hourly_rate_min,
      latest.hourly_rate_max,
      latest.relocation_required
    FROM latest_matches latest
    JOIN public.social_jobs social ON social.id::text = latest.lead_id
    WHERE social.hidden_at IS NULL
      AND COALESCE(social.posted_at, social.created_at) >= COALESCE(p_since, now() - interval '72 hours')
  )
  SELECT *
  FROM feed_rows
  WHERE p_before_posted_at IS NULL
     OR (effective_posted_at, lead_id) < (p_before_posted_at, COALESCE(p_before_lead_id, ''))
  ORDER BY effective_posted_at DESC, lead_id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 1000), 1000));
$$;

CREATE OR REPLACE FUNCTION public.get_social_hotlist_feed_page(
  p_since timestamptz,
  p_before_posted_at timestamptz DEFAULT NULL,
  p_before_lead_id text DEFAULT NULL,
  p_limit integer DEFAULT 1000
)
RETURNS TABLE (
  lead_id text,
  profile_id uuid,
  match_created_at timestamptz,
  final_average_score double precision,
  score_breakdown jsonb,
  platform text,
  posted_by_name text,
  poster_email text,
  poster_phone text,
  social_created_at timestamptz,
  posted_at timestamptz,
  effective_posted_at timestamptz,
  job_title text,
  company_name text,
  location text,
  post_content text,
  extracted_role_normalized text,
  employment_type text,
  seniority_level text,
  salary_range text,
  extracted_skills text[],
  extracted_experience_years integer,
  extracted_visa_types text[],
  extracted_hourly_rate_min numeric,
  extracted_hourly_rate_max numeric,
  role_title text,
  core_skills text[],
  years_experience numeric,
  visa_types text[],
  work_type text,
  locations text[],
  hourly_rate_min numeric,
  hourly_rate_max numeric,
  relocation_required boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    hotlist.id::text,
    matches.profile_id,
    matches.created_at,
    matches.final_average_score::double precision,
    matches.score_breakdown,
    hotlist.platform,
    hotlist.bench_sales_recruiter_name,
    hotlist.bench_sales_recruiter_email,
    hotlist.bench_sales_recruiter_phone,
    hotlist.created_at,
    hotlist.posted_at,
    COALESCE(hotlist.posted_at, hotlist.created_at),
    hotlist.role_title,
    hotlist.bench_sales_company_name,
    COALESCE(array_to_string(hotlist.locations, ', '), ''),
    hotlist.raw_post_content,
    hotlist.role_title,
    hotlist.employment_type,
    '',
    CASE
      WHEN hotlist.hourly_rate_min IS NOT NULL OR hotlist.hourly_rate_max IS NOT NULL
        THEN concat('$', COALESCE(hotlist.hourly_rate_min::text, '?'), '-$', COALESCE(hotlist.hourly_rate_max::text, '?'), '/hr')
      ELSE ''
    END,
    hotlist.core_skills,
    hotlist.years_experience::integer,
    CASE WHEN hotlist.visa_type = '' THEN '{}'::text[] ELSE array[hotlist.visa_type] END,
    hotlist.hourly_rate_min,
    hotlist.hourly_rate_max,
    matches.role_title,
    matches.core_skills,
    matches.years_experience,
    matches.visa_types,
    matches.work_type,
    matches.locations,
    matches.hourly_rate_min,
    matches.hourly_rate_max,
    NULL::boolean
  FROM public.radar_match_hotlist matches
  JOIN public.social_hotlist hotlist ON hotlist.id = matches.hotlist_id
  WHERE hotlist.hidden_at IS NULL
    AND COALESCE(hotlist.posted_at, hotlist.created_at) >= COALESCE(p_since, now() - interval '72 hours')
    AND (
      p_before_posted_at IS NULL
      OR (COALESCE(hotlist.posted_at, hotlist.created_at), hotlist.id::text)
        < (p_before_posted_at, COALESCE(p_before_lead_id, ''))
    )
  ORDER BY COALESCE(hotlist.posted_at, hotlist.created_at) DESC, hotlist.id::text DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 1000), 1000));
$$;
