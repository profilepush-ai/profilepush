-- get_social_hotlist_feed_page's user_post branch hardcoded work_type to
-- NULL (it's sourced from an AI match's radar_match_hotlist.work_type for
-- scraped/matched leads, which self-submitted posts never get) even though
-- the recruiter's own selected work_type is sitting right there on
-- social_hotlist. Same signature, so CREATE OR REPLACE is enough.

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
      hotlist.work_type,
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
