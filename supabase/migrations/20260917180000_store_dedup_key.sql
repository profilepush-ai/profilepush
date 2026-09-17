-- Precompute the de-duplication key at write time.
--
-- After inlining the facet helpers, the remaining per-query cost was the key
-- itself: several regex passes per row, recomputed for every page and every
-- facet count. It depends only on the row's own columns, so it belongs in a
-- stored column maintained by a trigger -- the pattern search_document already
-- uses on these tables.
--
-- social_jobs stores the whole key. social_hotlist stores everything except
-- the candidate index, which comes from the match row's score_breakdown rather
-- than from the hotlist itself and is appended at query time as a cheap jsonb
-- lookup with no regex.

alter table public.social_jobs add column if not exists dedup_key text;
alter table public.social_hotlist add column if not exists dedup_key_base text;

create or replace function public.pulse_hotlist_candidate_slot(p_score_breakdown jsonb, p_lead_id text)
returns text language sql immutable parallel safe as $$
  select case
    when jsonb_typeof(p_score_breakdown -> 'hotlist_source') = 'object'
     and (p_score_breakdown -> 'hotlist_source' ->> 'candidate_index') ~ '^-?\d+$'
    then p_score_breakdown -> 'hotlist_source' ->> 'candidate_index'
    else coalesce(p_lead_id, '')
  end;
$$;

create or replace function public.pulse_hotlist_dedup_key_base(
  p_role_title text, p_raw_post_content text, p_company_name text,
  p_locations text[], p_platform text, p_recruiter_email text, p_recruiter_name text
)
returns text language sql immutable parallel safe as $$
  select array_to_string(array[
    coalesce(public.pulse_dedupe_text(public.pulse_lead_title(p_role_title, p_role_title, p_raw_post_content, true)), ''),
    coalesce(public.pulse_dedupe_text(coalesce(p_company_name, '')), ''),
    coalesce(nullif(public.pulse_dedupe_text(coalesce(nullif(btrim(coalesce(array_to_string(p_locations, ', '), '')), ''), 'Location not specified')), ''), '-'),
    coalesce(nullif(public.pulse_dedupe_text(coalesce(p_platform, '')), ''), '-'),
    coalesce(
      nullif(public.pulse_dedupe_text(coalesce(p_recruiter_email, '')), ''),
      nullif(public.pulse_dedupe_text(coalesce(p_recruiter_name, '')), ''),
      '-'
    )
  ], '|');
$$;

create or replace function public.set_social_jobs_dedup_key()
returns trigger language plpgsql as $$
begin
  new.dedup_key := public.pulse_lead_dedup_key(
    new.job_title, new.extracted_role_normalized, new.post_content,
    new.company_name, new.location, new.platform,
    false, null, null, null, new.id::text
  );
  return new;
end;
$$;

drop trigger if exists trg_social_jobs_dedup_key on public.social_jobs;
create trigger trg_social_jobs_dedup_key
before insert or update of job_title, extracted_role_normalized, post_content, company_name, location, platform
on public.social_jobs
for each row execute function public.set_social_jobs_dedup_key();

create or replace function public.set_social_hotlist_dedup_key()
returns trigger language plpgsql as $$
begin
  new.dedup_key_base := public.pulse_hotlist_dedup_key_base(
    new.role_title, new.raw_post_content, new.bench_sales_company_name,
    new.locations, new.platform, new.bench_sales_recruiter_email,
    new.bench_sales_recruiter_name
  );
  return new;
end;
$$;

drop trigger if exists trg_social_hotlist_dedup_key on public.social_hotlist;
create trigger trg_social_hotlist_dedup_key
before insert or update of role_title, raw_post_content, bench_sales_company_name, locations, platform, bench_sales_recruiter_email, bench_sales_recruiter_name
on public.social_hotlist
for each row execute function public.set_social_hotlist_dedup_key();

update public.social_jobs
set dedup_key = public.pulse_lead_dedup_key(
  job_title, extracted_role_normalized, post_content,
  company_name, location, platform, false, null, null, null, id::text
)
where dedup_key is null;

update public.social_hotlist
set dedup_key_base = public.pulse_hotlist_dedup_key_base(
  role_title, raw_post_content, bench_sales_company_name,
  locations, platform, bench_sales_recruiter_email, bench_sales_recruiter_name
)
where dedup_key_base is null;

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
    social.search_document,
    social.dedup_key
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
    social.search_document,
    social.dedup_key
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
    hotlist.search_document,
    hotlist.dedup_key_base || '|' || public.pulse_hotlist_candidate_slot(matches.score_breakdown, hotlist.id::text) as dedup_key
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
    hotlist.search_document,
    hotlist.dedup_key_base || '|' || hotlist.id::text as dedup_key
  from public.social_hotlist hotlist
  left join public.account_members am
    on am.user_id = hotlist.created_by_user_id
   and am.account_id = hotlist.created_by_account_id
  where hotlist.post_source = 'user_post'
    and hotlist.hidden_at is null
    and hotlist.post_status = 'open';

-- The keyed views no longer compute anything; the key arrives on the row.
create or replace view public.pulse_feed_jobs_rows_keyed as
  select v.* from public.pulse_feed_jobs_rows v;

create or replace view public.pulse_feed_hotlist_rows_keyed as
  select v.* from public.pulse_feed_hotlist_rows v;

revoke all on public.pulse_feed_jobs_rows_keyed from public, anon, authenticated;
revoke all on public.pulse_feed_hotlist_rows_keyed from public, anon, authenticated;
