-- One publisher's posts in exactly the feed's row shape, so a profile can
-- render them with the feed's own cards and actions (AI Submit, Predict,
-- preview, share). Same source views, same 30-day window and the same dedupe
-- by dedup_key as get_pulse_social_feed_page_v2 / get_social_hotlist_feed_page_v2.
create or replace function public.get_publisher_feed_rows(p_publisher_id uuid, p_kind text)
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
  relocation_required boolean,
  post_source text,
  created_by_account_id uuid,
  created_by_user_id uuid,
  author_display_name text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_email text;
begin
  if auth.uid() is null or p_kind not in ('job', 'hotlist') then return; end if;
  select pp.email into v_email from public.publisher_profiles pp where pp.id = p_publisher_id;
  if v_email is null then return; end if;

  if p_kind = 'job' then
    return query
    with eligible as (
      select src.*,
        row_number() over (partition by src.dedup_key order by src.effective_posted_at desc, src.lead_id desc) as dedup_rank
      from public.pulse_feed_jobs_rows_keyed src
      where src.effective_posted_at >= now() - interval '30 days'
        and public.publisher_email_key(src.poster_email) = v_email
    )
    select
    lead_id, profile_id, match_created_at, final_average_score, score_breakdown,
    platform, posted_by_name, poster_email, poster_phone, social_created_at,
    posted_at, effective_posted_at, job_title, company_name, location, post_content,
    extracted_role_normalized, employment_type, seniority_level, salary_range,
    extracted_skills, extracted_experience_years, extracted_visa_types,
    extracted_hourly_rate_min, extracted_hourly_rate_max, role_title, core_skills,
    years_experience, visa_types, work_type, locations, hourly_rate_min,
    hourly_rate_max, relocation_required, post_source, created_by_account_id,
    created_by_user_id, author_display_name, avatar_url
    from eligible
    where dedup_rank = 1
    order by effective_posted_at desc, lead_id desc
    limit 200;
  else
    return query
    with eligible as (
      select src.*,
        row_number() over (partition by src.dedup_key order by src.effective_posted_at desc, src.lead_id desc) as dedup_rank
      from public.pulse_feed_hotlist_rows_keyed src
      where src.effective_posted_at >= now() - interval '30 days'
        and public.publisher_email_key(src.poster_email) = v_email
    )
    select
    lead_id, profile_id, match_created_at, final_average_score, score_breakdown,
    platform, posted_by_name, poster_email, poster_phone, social_created_at,
    posted_at, effective_posted_at, job_title, company_name, location, post_content,
    extracted_role_normalized, employment_type, seniority_level, salary_range,
    extracted_skills, extracted_experience_years, extracted_visa_types,
    extracted_hourly_rate_min, extracted_hourly_rate_max, role_title, core_skills,
    years_experience, visa_types, work_type, locations, hourly_rate_min,
    hourly_rate_max, relocation_required, post_source, created_by_account_id,
    created_by_user_id, author_display_name, avatar_url
    from eligible
    where dedup_rank = 1
    order by effective_posted_at desc, lead_id desc
    limit 200;
  end if;
end;
$$;

revoke all on function public.get_publisher_feed_rows(uuid, text) from public, anon;
grant execute on function public.get_publisher_feed_rows(uuid, text) to authenticated;
