-- Global Pulse social feed RPC.
-- Returns social radar matches across all accounts (bypassing account-scoped RLS)
-- so Pulse can render the same global feed for every authenticated user.

create or replace function public.get_pulse_social_feed(
  p_since timestamptz,
  p_limit integer default 5000
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
language sql
security definer
set search_path = public
as $$
  with latest_matches as (
    select distinct on (r.job_id)
      r.job_id::text as lead_id,
      r.profile_id,
      r.created_at as match_created_at,
      r.final_average_score,
      r.score_breakdown
    from public.radar_match_results r
    where r.job_source = 'social'
      and r.created_at >= coalesce(p_since, now() - interval '72 hours')
    order by r.job_id, r.created_at desc
  )
  select
    lm.lead_id,
    lm.profile_id,
    lm.match_created_at,
    lm.final_average_score,
    lm.score_breakdown,
    s.platform,
    s.posted_by_name,
    s.poster_email,
    s.poster_phone,
    s.created_at as social_created_at,
    s.posted_at,
    s.job_title,
    s.company_name,
    s.location,
    s.post_content,
    s.extracted_role_normalized,
    s.employment_type,
    s.seniority_level,
    s.salary_range,
    case
      when s.extracted_skills is null then null
      when jsonb_typeof(s.extracted_skills) = 'array' then array(select jsonb_array_elements_text(s.extracted_skills))
      else null
    end as extracted_skills,
    s.extracted_experience_years,
    case
      when s.extracted_visa_types is null then null
      when jsonb_typeof(s.extracted_visa_types) = 'array' then array(select jsonb_array_elements_text(s.extracted_visa_types))
      else null
    end as extracted_visa_types,
    s.extracted_hourly_rate_min,
    s.extracted_hourly_rate_max
  from latest_matches lm
  join public.social_jobs s on s.id::text = lm.lead_id
  order by lm.match_created_at desc
  limit greatest(1, least(coalesce(p_limit, 5000), 10000));
$$;

revoke all on function public.get_pulse_social_feed(timestamptz, integer) from public;
grant execute on function public.get_pulse_social_feed(timestamptz, integer) to authenticated;
