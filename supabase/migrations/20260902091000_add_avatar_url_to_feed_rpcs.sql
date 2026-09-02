-- Add avatar_url (trailing column, same name across all three) to the Pulse
-- feed RPCs so the frontend can show a recruiter/vendor photo. Return
-- signature changes, so DROP FUNCTION + CREATE rather than CREATE OR
-- REPLACE — dropping a function loses its grants, so each is re-granted
-- below exactly matching 20260819120000_include_user_posts_in_feed_rpcs.sql.

DROP FUNCTION IF EXISTS public.get_pulse_social_feed(timestamptz, integer);
DROP FUNCTION IF EXISTS public.get_pulse_social_feed_page(timestamptz, timestamptz, text, integer);
DROP FUNCTION IF EXISTS public.get_social_hotlist_feed_page(timestamptz, timestamptz, text, integer);

CREATE FUNCTION public.get_pulse_social_feed(
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
  extracted_hourly_rate_max numeric,
  post_source text,
  created_by_account_id uuid,
  created_by_user_id uuid,
  author_display_name text,
  avatar_url text
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
  ), feed_rows AS (
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
      s.extracted_hourly_rate_max,
      s.post_source,
      NULL::uuid AS created_by_account_id,
      NULL::uuid AS created_by_user_id,
      NULL::text AS author_display_name,
      s.avatar_url
    FROM latest_matches lm
    JOIN public.social_jobs s ON s.id::text = lm.lead_id
    WHERE s.hidden_at IS NULL
      AND s.post_source = 'linkedin_scrape'

    UNION ALL

    SELECT
      s.id::text AS lead_id,
      NULL::uuid AS profile_id,
      s.created_at AS match_created_at,
      NULL::double precision AS final_average_score,
      '{}'::jsonb AS score_breakdown,
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
      s.extracted_hourly_rate_max,
      s.post_source,
      s.created_by_account_id,
      s.created_by_user_id,
      COALESCE(NULLIF(TRIM(am.display_name), ''), split_part(am.invited_email, '@', 1), 'ProfilePush user') AS author_display_name,
      s.avatar_url
    FROM public.social_jobs s
    LEFT JOIN public.account_members am ON am.user_id = s.created_by_user_id AND am.account_id = s.created_by_account_id
    WHERE s.post_source = 'user_post'
      AND s.hidden_at IS NULL
      AND s.post_status = 'open'
      AND COALESCE(s.posted_at, s.created_at) >= COALESCE(p_since, now() - interval '72 hours')
  )
  SELECT *
  FROM feed_rows
  ORDER BY match_created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5000), 10000));
$$;

REVOKE ALL ON FUNCTION public.get_pulse_social_feed(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pulse_social_feed(timestamptz, integer) TO authenticated;


CREATE FUNCTION public.get_pulse_social_feed_page(
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
  relocation_required boolean,
  post_source text,
  created_by_account_id uuid,
  created_by_user_id uuid,
  author_display_name text,
  avatar_url text
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
      latest.relocation_required,
      social.post_source,
      NULL::uuid AS created_by_account_id,
      NULL::uuid AS created_by_user_id,
      NULL::text AS author_display_name,
      social.avatar_url
    FROM latest_matches latest
    JOIN public.social_jobs social ON social.id::text = latest.lead_id
    WHERE social.hidden_at IS NULL
      AND social.post_source = 'linkedin_scrape'
      AND COALESCE(social.posted_at, social.created_at) >= COALESCE(p_since, now() - interval '72 hours')

    UNION ALL

    SELECT
      social.id::text AS lead_id,
      NULL::uuid AS profile_id,
      social.created_at AS match_created_at,
      NULL::double precision AS final_average_score,
      '{}'::jsonb AS score_breakdown,
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
      NULL::text AS role_title,
      NULL::text[] AS core_skills,
      NULL::numeric AS years_experience,
      NULL::text[] AS visa_types,
      NULL::text AS work_type,
      NULL::text[] AS locations,
      NULL::numeric AS hourly_rate_min,
      NULL::numeric AS hourly_rate_max,
      NULL::boolean AS relocation_required,
      social.post_source,
      social.created_by_account_id,
      social.created_by_user_id,
      COALESCE(NULLIF(TRIM(am.display_name), ''), split_part(am.invited_email, '@', 1), 'ProfilePush user') AS author_display_name,
      social.avatar_url
    FROM public.social_jobs social
    LEFT JOIN public.account_members am ON am.user_id = social.created_by_user_id AND am.account_id = social.created_by_account_id
    WHERE social.post_source = 'user_post'
      AND social.hidden_at IS NULL
      AND social.post_status = 'open'
      AND COALESCE(social.posted_at, social.created_at) >= COALESCE(p_since, now() - interval '72 hours')
  )
  SELECT *
  FROM feed_rows
  WHERE p_before_posted_at IS NULL
     OR (effective_posted_at, lead_id) < (p_before_posted_at, COALESCE(p_before_lead_id, ''))
  ORDER BY effective_posted_at DESC, lead_id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 1000), 1000));
$$;

REVOKE ALL ON FUNCTION public.get_pulse_social_feed_page(timestamptz, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pulse_social_feed_page(timestamptz, timestamptz, text, integer) TO anon, authenticated, service_role;


CREATE FUNCTION public.get_social_hotlist_feed_page(
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
  relocation_required boolean,
  post_source text,
  created_by_account_id uuid,
  created_by_user_id uuid,
  author_display_name text,
  avatar_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH feed_rows AS (
    SELECT
      hotlist.id::text AS lead_id,
      matches.profile_id,
      matches.created_at AS match_created_at,
      matches.final_average_score::double precision AS final_average_score,
      matches.score_breakdown,
      hotlist.platform,
      hotlist.bench_sales_recruiter_name AS posted_by_name,
      hotlist.bench_sales_recruiter_email AS poster_email,
      hotlist.bench_sales_recruiter_phone AS poster_phone,
      hotlist.created_at AS social_created_at,
      hotlist.posted_at,
      COALESCE(hotlist.posted_at, hotlist.created_at) AS effective_posted_at,
      hotlist.role_title AS job_title,
      hotlist.bench_sales_company_name AS company_name,
      COALESCE(array_to_string(hotlist.locations, ', '), '') AS location,
      hotlist.raw_post_content AS post_content,
      hotlist.role_title AS extracted_role_normalized,
      hotlist.employment_type,
      '' AS seniority_level,
      CASE
        WHEN hotlist.hourly_rate_min IS NOT NULL OR hotlist.hourly_rate_max IS NOT NULL
          THEN concat('$', COALESCE(hotlist.hourly_rate_min::text, '?'), '-$', COALESCE(hotlist.hourly_rate_max::text, '?'), '/hr')
        ELSE ''
      END AS salary_range,
      hotlist.core_skills AS extracted_skills,
      hotlist.years_experience::integer AS extracted_experience_years,
      CASE WHEN hotlist.visa_type = '' THEN '{}'::text[] ELSE array[hotlist.visa_type] END AS extracted_visa_types,
      hotlist.hourly_rate_min AS extracted_hourly_rate_min,
      hotlist.hourly_rate_max AS extracted_hourly_rate_max,
      matches.role_title,
      matches.core_skills,
      matches.years_experience,
      matches.visa_types,
      matches.work_type,
      matches.locations,
      matches.hourly_rate_min,
      matches.hourly_rate_max,
      NULL::boolean AS relocation_required,
      hotlist.post_source,
      NULL::uuid AS created_by_account_id,
      NULL::uuid AS created_by_user_id,
      NULL::text AS author_display_name,
      hotlist.bench_sales_recruiter_avatar_url AS avatar_url
    FROM public.radar_match_hotlist matches
    JOIN public.social_hotlist hotlist ON hotlist.id = matches.hotlist_id
    WHERE hotlist.hidden_at IS NULL
      AND hotlist.post_source = 'linkedin_scrape'
      AND COALESCE(hotlist.posted_at, hotlist.created_at) >= COALESCE(p_since, now() - interval '72 hours')

    UNION ALL

    SELECT
      hotlist.id::text AS lead_id,
      NULL::uuid AS profile_id,
      hotlist.created_at AS match_created_at,
      NULL::double precision AS final_average_score,
      '{}'::jsonb AS score_breakdown,
      hotlist.platform,
      hotlist.bench_sales_recruiter_name AS posted_by_name,
      hotlist.bench_sales_recruiter_email AS poster_email,
      hotlist.bench_sales_recruiter_phone AS poster_phone,
      hotlist.created_at AS social_created_at,
      hotlist.posted_at,
      COALESCE(hotlist.posted_at, hotlist.created_at) AS effective_posted_at,
      hotlist.role_title AS job_title,
      hotlist.bench_sales_company_name AS company_name,
      COALESCE(array_to_string(hotlist.locations, ', '), '') AS location,
      hotlist.raw_post_content AS post_content,
      hotlist.role_title AS extracted_role_normalized,
      hotlist.employment_type,
      '' AS seniority_level,
      CASE
        WHEN hotlist.hourly_rate_min IS NOT NULL OR hotlist.hourly_rate_max IS NOT NULL
          THEN concat('$', COALESCE(hotlist.hourly_rate_min::text, '?'), '-$', COALESCE(hotlist.hourly_rate_max::text, '?'), '/hr')
        ELSE ''
      END AS salary_range,
      hotlist.core_skills AS extracted_skills,
      hotlist.years_experience::integer AS extracted_experience_years,
      CASE WHEN hotlist.visa_type = '' THEN '{}'::text[] ELSE array[hotlist.visa_type] END AS extracted_visa_types,
      hotlist.hourly_rate_min AS extracted_hourly_rate_min,
      hotlist.hourly_rate_max AS extracted_hourly_rate_max,
      NULL::text AS role_title,
      NULL::text[] AS core_skills,
      NULL::numeric AS years_experience,
      NULL::text[] AS visa_types,
      NULL::text AS work_type,
      NULL::text[] AS locations,
      NULL::numeric AS hourly_rate_min,
      NULL::numeric AS hourly_rate_max,
      NULL::boolean AS relocation_required,
      hotlist.post_source,
      hotlist.created_by_account_id,
      hotlist.created_by_user_id,
      COALESCE(NULLIF(TRIM(am.display_name), ''), split_part(am.invited_email, '@', 1), 'ProfilePush user') AS author_display_name,
      hotlist.bench_sales_recruiter_avatar_url AS avatar_url
    FROM public.social_hotlist hotlist
    LEFT JOIN public.account_members am ON am.user_id = hotlist.created_by_user_id AND am.account_id = hotlist.created_by_account_id
    WHERE hotlist.post_source = 'user_post'
      AND hotlist.hidden_at IS NULL
      AND hotlist.post_status = 'open'
      AND COALESCE(hotlist.posted_at, hotlist.created_at) >= COALESCE(p_since, now() - interval '72 hours')
  )
  SELECT *
  FROM feed_rows
  WHERE p_before_posted_at IS NULL
     OR (effective_posted_at, lead_id) < (p_before_posted_at, COALESCE(p_before_lead_id, ''))
  ORDER BY effective_posted_at DESC, lead_id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 1000), 1000));
$$;

REVOKE ALL ON FUNCTION public.get_social_hotlist_feed_page(timestamptz, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_social_hotlist_feed_page(timestamptz, timestamptz, text, integer) TO authenticated, service_role;
