create or replace function public.get_pulse_social_feed_page(
  p_since timestamptz,
  p_before_posted_at timestamptz default null,
  p_before_lead_id text default null,
  p_limit integer default 1000
)
returns table (
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
language sql
security definer
set search_path = public
as $$
  with latest_matches as (
    select distinct on (matches.job_id)
      matches.job_id::text as lead_id,
      matches.profile_id,
      matches.created_at as match_created_at,
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
    from public.radar_match_results matches
    where matches.job_source = 'social'
    order by matches.job_id, matches.created_at desc
  ), feed_rows as (
    select
      latest.lead_id,
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
      latest.relocation_required
    from latest_matches latest
    join public.social_jobs social on social.id::text = latest.lead_id
    where coalesce(social.posted_at, social.created_at) >= coalesce(p_since, now() - interval '72 hours')
  )
  select *
  from feed_rows
  where p_before_posted_at is null
     or (effective_posted_at, lead_id) < (p_before_posted_at, coalesce(p_before_lead_id, ''))
  order by effective_posted_at desc, lead_id desc
  limit greatest(1, least(coalesce(p_limit, 1000), 1000));
$$;

revoke all on function public.get_pulse_social_feed_page(timestamptz, timestamptz, text, integer) from public;
grant execute on function public.get_pulse_social_feed_page(timestamptz, timestamptz, text, integer) to anon, authenticated, service_role;