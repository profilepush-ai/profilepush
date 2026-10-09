/*
# Feed: show Non-IT jobs from staffing firms' career sites

Career-site jobs are structured listings from the firms themselves, so the
Non-IT ones are shown in the Feed alongside IT (US only, no recruiter/HR
roles). LinkedIn Non-IT posts stay hidden. The Tracker matchers still use
pp_job_lead_ok, so they keep matching IT roles only. Only the career-site
branch's WHERE clause changes; columns are identical.
*/

create or replace view public.pulse_feed_jobs_rows as
 SELECT social.id::text AS lead_id,
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
            WHEN social.extracted_skills IS NULL THEN NULL::text[]
            WHEN jsonb_typeof(social.extracted_skills) = 'array'::text THEN ARRAY( SELECT jsonb_array_elements_text(social.extracted_skills) AS jsonb_array_elements_text)
            ELSE NULL::text[]
        END AS extracted_skills,
    social.extracted_experience_years,
        CASE
            WHEN social.extracted_visa_types IS NULL THEN NULL::text[]
            WHEN jsonb_typeof(social.extracted_visa_types) = 'array'::text THEN ARRAY( SELECT jsonb_array_elements_text(social.extracted_visa_types) AS jsonb_array_elements_text)
            ELSE NULL::text[]
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
    social.avatar_url,
    social.search_document,
    social.dedup_key
   FROM social_jobs social
     JOIN LATERAL ( SELECT r.profile_id,
            r.created_at AS match_created_at,
            r.final_average_score,
            r.score_breakdown,
            r.role_title,
            r.core_skills,
            r.years_experience,
            r.visa_types,
            r.work_type,
            r.locations,
            r.hourly_rate_min,
            r.hourly_rate_max,
            r.relocation_required
           FROM radar_match_results r
          WHERE r.job_source = 'social'::text AND r.job_id = social.id
          ORDER BY r.created_at DESC
         LIMIT 1) latest ON true
  WHERE social.hidden_at IS NULL AND social.post_source = 'linkedin_scrape'::text AND COALESCE(btrim(social.poster_email), ''::text) <> ''::text
    AND pp_job_lead_ok(social.country, social.job_category, social.job_title, social.location)
UNION ALL
 SELECT social.id::text AS lead_id,
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
            WHEN social.extracted_skills IS NULL THEN NULL::text[]
            WHEN jsonb_typeof(social.extracted_skills) = 'array'::text THEN ARRAY( SELECT jsonb_array_elements_text(social.extracted_skills) AS jsonb_array_elements_text)
            ELSE NULL::text[]
        END AS extracted_skills,
    social.extracted_experience_years,
        CASE
            WHEN social.extracted_visa_types IS NULL THEN NULL::text[]
            WHEN jsonb_typeof(social.extracted_visa_types) = 'array'::text THEN ARRAY( SELECT jsonb_array_elements_text(social.extracted_visa_types) AS jsonb_array_elements_text)
            ELSE NULL::text[]
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
    COALESCE(NULLIF(TRIM(BOTH FROM am.display_name), ''::text), split_part(am.invited_email, '@'::text, 1), 'ProfilePush user'::text) AS author_display_name,
    social.avatar_url,
    social.search_document,
    social.dedup_key
   FROM social_jobs social
     LEFT JOIN account_members am ON am.user_id = social.created_by_user_id AND am.account_id = social.created_by_account_id
  WHERE social.post_source = 'user_post'::text AND social.hidden_at IS NULL AND social.post_status = 'open'::text
UNION ALL
 SELECT social.id::text AS lead_id,
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
            WHEN social.extracted_skills IS NULL THEN NULL::text[]
            WHEN jsonb_typeof(social.extracted_skills) = 'array'::text THEN ARRAY( SELECT jsonb_array_elements_text(social.extracted_skills) AS jsonb_array_elements_text)
            ELSE NULL::text[]
        END AS extracted_skills,
    social.extracted_experience_years,
        CASE
            WHEN social.extracted_visa_types IS NULL THEN NULL::text[]
            WHEN jsonb_typeof(social.extracted_visa_types) = 'array'::text THEN ARRAY( SELECT jsonb_array_elements_text(social.extracted_visa_types) AS jsonb_array_elements_text)
            ELSE NULL::text[]
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
    NULL::uuid AS created_by_account_id,
    NULL::uuid AS created_by_user_id,
    NULL::text AS author_display_name,
    social.avatar_url,
    social.search_document,
    social.dedup_key
   FROM social_jobs social
  WHERE social.post_source = 'career_site'::text AND social.hidden_at IS NULL AND social.post_status = 'open'::text
    AND COALESCE(social.country, 'US'::text) = 'US'::text AND NOT pp_is_recruiter_role(social.job_title);
