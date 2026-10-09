/*
# Requirements from staffing firms' career sites

Jobs that prime vendors (TEKsystems, Judge, ...) publish on their own career
sites, collected hourly by the career-sites-scraper worker through the
receive-career-jobs function. They carry no poster email: the action is Apply
on the prime's site (post_url), not an emailed submission.

1. social_jobs.post_source accepts 'career_site' (platform 'career_site',
   post_id '<prime-slug>:<job id>').
2. career_site_jobs: every listing the scraper has seen, accepted or not, so a
   rejected listing is not fetched and parsed again every hour, and listings
   that disappear from a site are closed.
3. pulse_feed_jobs_rows gets a third branch for open career-site jobs (same
   columns, so the _keyed view, the feed RPCs and AI Match pick them up).
   The Tracker matchers already accept non-LinkedIn leads without an email.
4. external_applications + mark_external_applied(): "Applied on the prime's
   site". Logs the application once per account, job and consultant, and
   moves the matching Tracker cards from New to Submitted.
*/

alter table public.social_jobs drop constraint if exists social_jobs_post_source_check;
alter table public.social_jobs add constraint social_jobs_post_source_check
  check (post_source = any (array['linkedin_scrape'::text, 'user_post'::text, 'career_site'::text]));

create table if not exists public.career_site_jobs (
  prime text not null,
  source_id text not null,
  url text not null,
  status text not null check (status in ('accepted', 'rejected', 'closed')),
  reason text,
  social_job_id uuid references public.social_jobs(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (prime, source_id)
);
alter table public.career_site_jobs enable row level security;
create index if not exists career_site_jobs_social_job_idx on public.career_site_jobs (social_job_id);

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
    AND pp_job_lead_ok(social.country, social.job_category, social.job_title, social.location);


create table if not exists public.external_applications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null,
  social_job_id uuid not null references public.social_jobs(id) on delete cascade,
  subject_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists external_applications_once
  on public.external_applications (account_id, social_job_id, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.external_applications enable row level security;
drop policy if exists external_applications_select on public.external_applications;
create policy external_applications_select on public.external_applications
  for select to authenticated
  using (account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active'));

-- Record "Applied on the prime's site" for the caller's account. p_subject_id
-- is the consultant (hotlist) the application was for, when known (Tracker).
create or replace function public.mark_external_applied(p_job_id uuid, p_subject_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_moved integer;
begin
  select am.account_id into v_account
  from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active'
  order by am.created_at
  limit 1;
  if v_account is null then raise exception 'no account'; end if;
  if not exists (select 1 from public.social_jobs j where j.id = p_job_id and j.post_source = 'career_site') then
    raise exception 'not a career-site job';
  end if;

  insert into public.external_applications (account_id, user_id, social_job_id, subject_id)
  values (v_account, auth.uid(), p_job_id, p_subject_id)
  on conflict do nothing;

  update public.pipeline_cards c
  set stage = 'submitted', stage_changed_at = now(), updated_at = now()
  where c.account_id = v_account and c.lead_id = p_job_id and c.stage = 'new'
    and (p_subject_id is null or c.subject_id = p_subject_id);
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;
revoke all on function public.mark_external_applied(uuid, uuid) from public, anon;
grant execute on function public.mark_external_applied(uuid, uuid) to authenticated;
