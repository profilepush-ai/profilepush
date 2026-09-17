-- Push the "scraped rows must carry a contact" rule into the feed views.
--
-- loadFeed in PulsePage.tsx drops any row without a poster email unless it is
-- a user post:
--
--   ((row.poster_email ?? '').trim() || row.post_source === 'user_post')
--
-- While the client held the whole window that was free. With 100-row server
-- pages it isn't: the server would count a contactless row toward the page,
-- the client would discard it, and the user would get a short page — worse,
-- "load more" would appear to stall while the server dutifully returned rows
-- that never render. The predicate has to sit where the LIMIT is applied.
--
-- Only the scrape branch is touched; user posts are exempt in the client and
-- stay exempt here.

create or replace view public.pulse_feed_jobs_rows as
  select
    social.id::text as lead_id,
    latest.profile_id,
    latest.match_created_at,
    latest.final_average_score,
    latest.score_breakdown,
    social.platform,
    social.posted_by_name,
    social.poster_email,
    social.poster_phone,
    social.created_at as social_created_at,
    social.posted_at,
    coalesce(social.posted_at, social.created_at) as effective_posted_at,
    social.job_title,
    social.company_name,
    social.location,
    social.post_content,
    social.extracted_role_normalized,
    social.employment_type,
    social.seniority_level,
    social.salary_range,
    case
      when social.extracted_skills is null then null
      when jsonb_typeof(social.extracted_skills) = 'array' then array(select jsonb_array_elements_text(social.extracted_skills))
      else null
    end as extracted_skills,
    social.extracted_experience_years,
    case
      when social.extracted_visa_types is null then null
      when jsonb_typeof(social.extracted_visa_types) = 'array' then array(select jsonb_array_elements_text(social.extracted_visa_types))
      else null
    end as extracted_visa_types,
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
    null::uuid as created_by_account_id,
    null::uuid as created_by_user_id,
    null::text as author_display_name,
    social.avatar_url,
    social.search_document
  from public.social_jobs social
  join lateral (
    select
      r.profile_id,
      r.created_at as match_created_at,
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
    from public.radar_match_results r
    where r.job_source = 'social'
      and r.job_id = social.id
    order by r.created_at desc
    limit 1
  ) latest on true
  where social.hidden_at is null
    and social.post_source = 'linkedin_scrape'
    and coalesce(btrim(social.poster_email), '') <> ''

  union all

  select
    social.id::text as lead_id,
    null::uuid as profile_id,
    social.created_at as match_created_at,
    null::double precision as final_average_score,
    '{}'::jsonb as score_breakdown,
    social.platform,
    social.posted_by_name,
    social.poster_email,
    social.poster_phone,
    social.created_at as social_created_at,
    social.posted_at,
    coalesce(social.posted_at, social.created_at) as effective_posted_at,
    social.job_title,
    social.company_name,
    social.location,
    social.post_content,
    social.extracted_role_normalized,
    social.employment_type,
    social.seniority_level,
    social.salary_range,
    case
      when social.extracted_skills is null then null
      when jsonb_typeof(social.extracted_skills) = 'array' then array(select jsonb_array_elements_text(social.extracted_skills))
      else null
    end as extracted_skills,
    social.extracted_experience_years,
    case
      when social.extracted_visa_types is null then null
      when jsonb_typeof(social.extracted_visa_types) = 'array' then array(select jsonb_array_elements_text(social.extracted_visa_types))
      else null
    end as extracted_visa_types,
    social.extracted_hourly_rate_min,
    social.extracted_hourly_rate_max,
    null::text as role_title,
    null::text[] as core_skills,
    null::numeric as years_experience,
    null::text[] as visa_types,
    null::text as work_type,
    null::text[] as locations,
    null::numeric as hourly_rate_min,
    null::numeric as hourly_rate_max,
    null::boolean as relocation_required,
    social.post_source,
    social.created_by_account_id,
    social.created_by_user_id,
    coalesce(nullif(trim(am.display_name), ''), split_part(am.invited_email, '@', 1), 'ProfilePush user') as author_display_name,
    social.avatar_url,
    social.search_document
  from public.social_jobs social
  left join public.account_members am
    on am.user_id = social.created_by_user_id
   and am.account_id = social.created_by_account_id
  where social.post_source = 'user_post'
    and social.hidden_at is null
    and social.post_status = 'open';

create or replace view public.pulse_feed_hotlist_rows as
  select
    hotlist.id::text as lead_id,
    matches.profile_id,
    matches.created_at as match_created_at,
    matches.final_average_score::double precision as final_average_score,
    matches.score_breakdown,
    hotlist.platform,
    hotlist.bench_sales_recruiter_name as posted_by_name,
    hotlist.bench_sales_recruiter_email as poster_email,
    hotlist.bench_sales_recruiter_phone as poster_phone,
    hotlist.created_at as social_created_at,
    hotlist.posted_at,
    coalesce(hotlist.posted_at, hotlist.created_at) as effective_posted_at,
    hotlist.role_title as job_title,
    hotlist.bench_sales_company_name as company_name,
    coalesce(array_to_string(hotlist.locations, ', '), '') as location,
    hotlist.raw_post_content as post_content,
    hotlist.role_title as extracted_role_normalized,
    hotlist.employment_type,
    '' as seniority_level,
    case
      when hotlist.hourly_rate_min is not null or hotlist.hourly_rate_max is not null
        then concat('$', coalesce(hotlist.hourly_rate_min::text, '?'), '-$', coalesce(hotlist.hourly_rate_max::text, '?'), '/hr')
      else ''
    end as salary_range,
    hotlist.core_skills as extracted_skills,
    hotlist.years_experience::integer as extracted_experience_years,
    case when hotlist.visa_type = '' then '{}'::text[] else array[hotlist.visa_type] end as extracted_visa_types,
    hotlist.hourly_rate_min as extracted_hourly_rate_min,
    hotlist.hourly_rate_max as extracted_hourly_rate_max,
    matches.role_title,
    matches.core_skills,
    matches.years_experience,
    matches.visa_types,
    matches.work_type,
    matches.locations,
    matches.hourly_rate_min,
    matches.hourly_rate_max,
    null::boolean as relocation_required,
    hotlist.post_source,
    null::uuid as created_by_account_id,
    null::uuid as created_by_user_id,
    null::text as author_display_name,
    hotlist.bench_sales_recruiter_avatar_url as avatar_url,
    hotlist.search_document
  from public.social_hotlist hotlist
  join lateral (
    select
      m.profile_id,
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
    from public.radar_match_hotlist m
    where m.hotlist_id = hotlist.id
    order by m.created_at desc
    limit 1
  ) matches on true
  where hotlist.hidden_at is null
    and hotlist.post_source = 'linkedin_scrape'
    and coalesce(btrim(hotlist.bench_sales_recruiter_email), '') <> ''

  union all

  select
    hotlist.id::text as lead_id,
    null::uuid as profile_id,
    hotlist.created_at as match_created_at,
    null::double precision as final_average_score,
    '{}'::jsonb as score_breakdown,
    hotlist.platform,
    hotlist.bench_sales_recruiter_name as posted_by_name,
    hotlist.bench_sales_recruiter_email as poster_email,
    hotlist.bench_sales_recruiter_phone as poster_phone,
    hotlist.created_at as social_created_at,
    hotlist.posted_at,
    coalesce(hotlist.posted_at, hotlist.created_at) as effective_posted_at,
    hotlist.role_title as job_title,
    hotlist.bench_sales_company_name as company_name,
    coalesce(array_to_string(hotlist.locations, ', '), '') as location,
    hotlist.raw_post_content as post_content,
    hotlist.role_title as extracted_role_normalized,
    hotlist.employment_type,
    '' as seniority_level,
    case
      when hotlist.hourly_rate_min is not null or hotlist.hourly_rate_max is not null
        then concat('$', coalesce(hotlist.hourly_rate_min::text, '?'), '-$', coalesce(hotlist.hourly_rate_max::text, '?'), '/hr')
      else ''
    end as salary_range,
    hotlist.core_skills as extracted_skills,
    hotlist.years_experience::integer as extracted_experience_years,
    case when hotlist.visa_type = '' then '{}'::text[] else array[hotlist.visa_type] end as extracted_visa_types,
    hotlist.hourly_rate_min as extracted_hourly_rate_min,
    hotlist.hourly_rate_max as extracted_hourly_rate_max,
    null::text as role_title,
    null::text[] as core_skills,
    null::numeric as years_experience,
    null::text[] as visa_types,
    null::text as work_type,
    null::text[] as locations,
    null::numeric as hourly_rate_min,
    null::numeric as hourly_rate_max,
    null::boolean as relocation_required,
    hotlist.post_source,
    hotlist.created_by_account_id,
    hotlist.created_by_user_id,
    coalesce(nullif(trim(am.display_name), ''), split_part(am.invited_email, '@', 1), 'ProfilePush user') as author_display_name,
    hotlist.bench_sales_recruiter_avatar_url as avatar_url,
    hotlist.search_document
  from public.social_hotlist hotlist
  left join public.account_members am
    on am.user_id = hotlist.created_by_user_id
   and am.account_id = hotlist.created_by_account_id
  where hotlist.post_source = 'user_post'
    and hotlist.hidden_at is null
    and hotlist.post_status = 'open';
