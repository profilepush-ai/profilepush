/*
# Feed: hide junk and collapse reposted consultants

- Scraped requirements in the Feed must pass pp_job_lead_ok (no known non-US
  posts, no Non-IT, no jobs for recruiters/HR/sales, no clearly non-US
  location). Scraped consultants must pass pp_hotlist_lead_ok. Users' own
  posts are unchanged.
- Scraped consultants that carry a name are grouped by name + role +
  recruiter email, so the same consultant reposted daily by the same
  recruiter shows once (the newest post). Others keep the previous key.

Only the WHERE clause and the hotlist dedup_key expression change; columns are
identical, so the _keyed views and every feed function pick this up as-is.
Measured (rolled back, 72h window): requirements 1,614 -> 1,466, consultants
361 -> 345, timings unchanged within a few ms.
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
  WHERE social.post_source = 'user_post'::text AND social.hidden_at IS NULL AND social.post_status = 'open'::text;

create or replace view public.pulse_feed_hotlist_rows as
 SELECT hotlist.id::text AS lead_id,
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
    COALESCE(array_to_string(hotlist.locations, ', '::text), ''::text) AS location,
    hotlist.raw_post_content AS post_content,
    hotlist.role_title AS extracted_role_normalized,
    hotlist.employment_type,
    ''::text AS seniority_level,
        CASE
            WHEN hotlist.hourly_rate_min IS NOT NULL OR hotlist.hourly_rate_max IS NOT NULL THEN concat('$', COALESCE(hotlist.hourly_rate_min::text, '?'::text), '-$', COALESCE(hotlist.hourly_rate_max::text, '?'::text), '/hr')
            ELSE ''::text
        END AS salary_range,
    hotlist.core_skills AS extracted_skills,
    hotlist.years_experience::integer AS extracted_experience_years,
        CASE
            WHEN hotlist.visa_type = ''::text THEN '{}'::text[]
            ELSE ARRAY[hotlist.visa_type]
        END AS extracted_visa_types,
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
    hotlist.bench_sales_recruiter_avatar_url AS avatar_url,
    hotlist.search_document,
    CASE
            WHEN length(pulse_dedupe_text(COALESCE(hotlist.candidate_name, ''::text))) >= 3
            THEN 'consultant|'::text || pulse_dedupe_text(hotlist.candidate_name) || '|'::text || COALESCE(pulse_dedupe_text(hotlist.role_title), ''::text) || '|'::text || lower(COALESCE(btrim(hotlist.bench_sales_recruiter_email), ''::text))
            ELSE (hotlist.dedup_key_base || '|'::text) || pulse_hotlist_candidate_slot(matches.score_breakdown, hotlist.id::text)
        END AS dedup_key
   FROM social_hotlist hotlist
     JOIN LATERAL ( SELECT m.profile_id,
            m.created_at,
            m.final_average_score,
            m.score_breakdown,
            m.role_title,
            m.core_skills,
            m.years_experience,
            m.visa_types,
            m.work_type,
            m.locations,
            m.hourly_rate_min,
            m.hourly_rate_max
           FROM radar_match_hotlist m
          WHERE m.hotlist_id = hotlist.id
          ORDER BY m.created_at DESC
         LIMIT 1) matches ON true
  WHERE hotlist.hidden_at IS NULL AND hotlist.post_source = 'linkedin_scrape'::text AND COALESCE(btrim(hotlist.bench_sales_recruiter_email), ''::text) <> ''::text
    AND pp_hotlist_lead_ok(hotlist.country, hotlist.job_category, hotlist.role_title, hotlist.locations)
UNION ALL
 SELECT hotlist.id::text AS lead_id,
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
    COALESCE(array_to_string(hotlist.locations, ', '::text), ''::text) AS location,
    hotlist.raw_post_content AS post_content,
    hotlist.role_title AS extracted_role_normalized,
    hotlist.employment_type,
    ''::text AS seniority_level,
        CASE
            WHEN hotlist.hourly_rate_min IS NOT NULL OR hotlist.hourly_rate_max IS NOT NULL THEN concat('$', COALESCE(hotlist.hourly_rate_min::text, '?'::text), '-$', COALESCE(hotlist.hourly_rate_max::text, '?'::text), '/hr')
            ELSE ''::text
        END AS salary_range,
    hotlist.core_skills AS extracted_skills,
    hotlist.years_experience::integer AS extracted_experience_years,
        CASE
            WHEN hotlist.visa_type = ''::text THEN '{}'::text[]
            ELSE ARRAY[hotlist.visa_type]
        END AS extracted_visa_types,
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
    COALESCE(NULLIF(TRIM(BOTH FROM am.display_name), ''::text), split_part(am.invited_email, '@'::text, 1), 'ProfilePush user'::text) AS author_display_name,
    hotlist.bench_sales_recruiter_avatar_url AS avatar_url,
    hotlist.search_document,
    (hotlist.dedup_key_base || '|'::text) || hotlist.id::text AS dedup_key
   FROM social_hotlist hotlist
     LEFT JOIN account_members am ON am.user_id = hotlist.created_by_user_id AND am.account_id = hotlist.created_by_account_id
  WHERE hotlist.post_source = 'user_post'::text AND hotlist.hidden_at IS NULL AND hotlist.post_status = 'open'::text;
