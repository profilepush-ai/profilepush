/*
# Internal (test) accounts, and Non-IT matching

1. accounts.is_internal: our own accounts used to quality-check matching.
   Their posts are left out of everyone else's Feed and are never matched
   into another account's Tracker (and so never charged to anyone); they can
   post past the free 3-post limit. They still get their own matches.
2. Non-IT consultants (social_hotlist.job_category = 'Non-IT') are matched to
   US Non-IT requirements (career-site data); everyone else keeps IT-only
   matching, unchanged.
*/
alter table public.accounts add column if not exists is_internal boolean not null default false;

create or replace function public.pp_is_internal_account(p_account_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select a.is_internal from public.accounts a where a.id = p_account_id), false);
$$;

update public.accounts set is_internal = true
where id in (
  select m.account_id from public.account_members m join auth.users u on u.id = m.user_id
  where m.status = 'active' and u.email in ('poornapotluri27@gmail.com', 'chanduchowdary24@gmail.com')
);

CREATE OR REPLACE FUNCTION public.refresh_pipeline_cards(p_lead_window interval DEFAULT '36:00:00'::interval, p_new_subjects_since timestamp with time zone DEFAULT (now() - '01:00:00'::interval), p_backfill_window interval DEFAULT '7 days'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_count integer := 0;
  v_added integer;
begin
  -- Consultants -> requirements.
  with subjects as (
    select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb,
      h.visa_type, h.locations, h.candidate_summary, (h.job_category = 'Non-IT') as non_it,
      case when h.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_hotlist h
    where h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
      and h.created_by_account_id is not null and h.hotlist_embedding is not null
  ),
  leads as (
    select j.id, j.job_embedding as emb, coalesce(j.posted_at, j.created_at) as at, j.created_by_account_id,
      j.extracted_visa_types, j.post_content, j.location, (j.job_category = 'Non-IT') as non_it
    from public.social_jobs j
    where j.hidden_at is null and j.job_embedding is not null
      and coalesce(j.post_status, 'open') = 'open'
      and coalesce(j.posted_at, j.created_at) >= now() - p_backfill_window
      and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
      and (public.pp_job_lead_ok(j.country, j.job_category, j.job_title, j.location) or (j.job_category = 'Non-IT' and coalesce(j.country, 'US') = 'US' and not public.pp_is_recruiter_role(j.job_title)))
      and not public.pp_is_internal_account(j.created_by_account_id)
  ),
  pairs as (
    select s.account_id, s.id as subject_id, l.id as lead_id, (1 - (s.emb <=> l.emb))::real as sim,
      l.extracted_visa_types, l.post_content, l.location, s.visa_type, s.locations, s.candidate_summary
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
      and coalesce(s.non_it, false) = coalesce(l.non_it, false)
  ),
  ranked as (
    select p.account_id, p.subject_id, p.lead_id, p.sim,
      row_number() over (partition by p.subject_id order by p.sim desc) as rn
    from pairs p
    where p.sim >= 0.70
      and not exists (select 1 from public.pipeline_cards c where c.subject_id = p.subject_id and c.lead_id = p.lead_id)
      and public.pp_pair_ok(p.extracted_visa_types, p.post_content, p.location, p.visa_type, p.locations, p.candidate_summary)
  )
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
  select account_id, 'hotlist', subject_id, 'job', lead_id, sim from ranked where rn <= 15
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  -- Requirements -> consultants.
  with subjects as (
    select j.id, j.created_by_account_id as account_id, j.job_embedding as emb,
      j.extracted_visa_types, j.post_content, j.location,
      case when j.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_jobs j
    where j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
      and j.created_by_account_id is not null and j.job_embedding is not null
  ),
  leads as (
    select h.id, h.hotlist_embedding as emb, coalesce(h.posted_at, h.created_at) as at, h.created_by_account_id,
      h.visa_type, h.locations, h.candidate_summary
    from public.social_hotlist h
    where h.hidden_at is null and h.hotlist_embedding is not null
      and (h.post_source <> 'linkedin_scrape' or coalesce(btrim(h.bench_sales_recruiter_email), '') <> '')
      and coalesce(h.post_status, 'open') = 'open'
      and coalesce(h.posted_at, h.created_at) >= now() - p_backfill_window
      and public.pp_hotlist_lead_ok(h.country, h.job_category, h.role_title, h.locations)
      and not public.pp_is_internal_account(h.created_by_account_id)
  ),
  pairs as (
    select s.account_id, s.id as subject_id, l.id as lead_id, (1 - (s.emb <=> l.emb))::real as sim,
      s.extracted_visa_types, s.post_content, s.location, l.visa_type, l.locations, l.candidate_summary
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
  ),
  ranked as (
    select p.account_id, p.subject_id, p.lead_id, p.sim,
      row_number() over (partition by p.subject_id order by p.sim desc) as rn
    from pairs p
    where p.sim >= 0.70
      and not exists (select 1 from public.pipeline_cards c where c.subject_id = p.subject_id and c.lead_id = p.lead_id)
      and public.pp_pair_ok(p.extracted_visa_types, p.post_content, p.location, p.visa_type, p.locations, p.candidate_summary)
  )
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
  select account_id, 'job', subject_id, 'hotlist', lead_id, sim from ranked where rn <= 15
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rematch_pipeline_subject(p_subject_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_added integer := 0;
  v_accounts uuid[];
  v_since timestamptz;
begin
  -- Only posts this column hasn't been checked against: those that came in
  -- since its last rematch (30-minute overlap for posts still being embedded),
  -- or the last 36 hours the first time.
  select coalesce(max(m.checked_at), now() - interval '36 hours') - interval '30 minutes' into v_since
  from public.pipeline_match_cursor m where m.subject_id = p_subject_id;
  select array_agg(am.account_id) into v_accounts
  from public.account_members am where am.user_id = auth.uid() and am.status = 'active';

  if exists (select 1 from public.social_hotlist h where h.id = p_subject_id and h.created_by_account_id = any(v_accounts)) then
    with s as (
      select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb, h.visa_type, h.locations, h.candidate_summary,
        coalesce(h.job_category = 'Non-IT', false) as non_it
      from public.social_hotlist h where h.id = p_subject_id and h.hotlist_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, j.id as lead_id, (1 - (s.emb <=> j.job_embedding))::real as sim,
        j.extracted_visa_types, j.post_content, j.location, s.visa_type, s.locations, s.candidate_summary
      from s join public.social_jobs j
        on j.hidden_at is null and j.job_embedding is not null and coalesce(j.post_status, 'open') = 'open'
       and j.created_at >= v_since
       and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
       and j.created_by_account_id is distinct from s.account_id
       and (public.pp_job_lead_ok(j.country, j.job_category, j.job_title, j.location) or (j.job_category = 'Non-IT' and coalesce(j.country, 'US') = 'US' and not public.pp_is_recruiter_role(j.job_title)))
       and not public.pp_is_internal_account(j.created_by_account_id)
       and coalesce(j.job_category = 'Non-IT', false) = s.non_it
      where not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = j.id)
      order by s.emb <=> j.job_embedding
      limit 15
    )
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
    select account_id, 'hotlist', subject_id, 'job', lead_id, sim from ranked
    where sim >= 0.70
      and public.pp_pair_ok(extracted_visa_types, post_content, location, visa_type, locations, candidate_summary)
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_added = row_count;
  elsif exists (select 1 from public.social_jobs j where j.id = p_subject_id and j.created_by_account_id = any(v_accounts)) then
    with s as (
      select j.id, j.created_by_account_id as account_id, j.job_embedding as emb, j.extracted_visa_types, j.post_content, j.location
      from public.social_jobs j where j.id = p_subject_id and j.job_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, h.id as lead_id, (1 - (s.emb <=> h.hotlist_embedding))::real as sim,
        s.extracted_visa_types, s.post_content, s.location, h.visa_type, h.locations, h.candidate_summary
      from s join public.social_hotlist h
        on h.hidden_at is null and h.hotlist_embedding is not null
       and (h.post_source <> 'linkedin_scrape' or coalesce(btrim(h.bench_sales_recruiter_email), '') <> '') and coalesce(h.post_status, 'open') = 'open'
       and h.created_at >= v_since
       and h.created_by_account_id is distinct from s.account_id
       and public.pp_hotlist_lead_ok(h.country, h.job_category, h.role_title, h.locations)
       and not public.pp_is_internal_account(h.created_by_account_id)
      where not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = h.id)
      order by s.emb <=> h.hotlist_embedding
      limit 15
    )
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
    select account_id, 'job', subject_id, 'hotlist', lead_id, sim from ranked
    where sim >= 0.70
      and public.pp_pair_ok(extracted_visa_types, post_content, location, visa_type, locations, candidate_summary)
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_added = row_count;
  else
    raise exception 'not your post';
  end if;
  insert into public.pipeline_match_cursor (subject_id, checked_at) values (p_subject_id, now())
  on conflict (subject_id) do update set checked_at = now();
  return v_added;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_free_post_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_open integer;
begin
  if new.post_source is distinct from 'user_post' or new.created_by_account_id is null then return new; end if;
  if public.pp_is_internal_account(new.created_by_account_id) then return new; end if;
  if coalesce(new.post_status, 'open') <> 'open' or new.hidden_at is not null then return new; end if;
  -- Updates only matter when they reopen a closed post.
  if tg_op = 'UPDATE' and coalesce(old.post_status, 'open') = 'open' and old.hidden_at is null then return new; end if;
  if public.account_has_paid(new.created_by_account_id) then return new; end if;

  select
    (select count(*) from public.social_hotlist h
      where h.created_by_account_id = new.created_by_account_id and h.post_source = 'user_post'
        and coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null and h.id <> new.id)
  + (select count(*) from public.social_jobs j
      where j.created_by_account_id = new.created_by_account_id and j.post_source = 'user_post'
        and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null and j.id <> new.id)
  into v_open;

  if v_open >= 3 then
    raise exception 'Free plan: up to 3 open consultants or requirements. Close one, or buy credits to add more.'
      using hint = 'free_plan_limit';
  end if;
  return new;
end;
$function$;

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
            WHEN length(pulse_dedupe_text(COALESCE(hotlist.candidate_name, ''::text))) >= 3 THEN (((('consultant|'::text || pulse_dedupe_text(hotlist.candidate_name)) || '|'::text) || COALESCE(pulse_dedupe_text(hotlist.role_title), ''::text)) || '|'::text) || lower(COALESCE(btrim(hotlist.bench_sales_recruiter_email), ''::text))
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
  WHERE hotlist.hidden_at IS NULL AND hotlist.post_source = 'linkedin_scrape'::text AND COALESCE(btrim(hotlist.bench_sales_recruiter_email), ''::text) <> ''::text AND pp_hotlist_lead_ok(hotlist.country, hotlist.job_category, hotlist.role_title, hotlist.locations)
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
  WHERE hotlist.post_source = 'user_post'::text AND hotlist.hidden_at IS NULL AND hotlist.post_status = 'open'::text
    AND NOT pp_is_internal_account(hotlist.created_by_account_id);

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
  WHERE social.hidden_at IS NULL AND social.post_source = 'linkedin_scrape'::text AND COALESCE(btrim(social.poster_email), ''::text) <> ''::text AND pp_job_lead_ok(social.country, social.job_category, social.job_title, social.location)
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
    AND NOT pp_is_internal_account(social.created_by_account_id)
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
  WHERE social.post_source = 'career_site'::text AND social.hidden_at IS NULL AND social.post_status = 'open'::text AND COALESCE(social.country, 'US'::text) = 'US'::text AND NOT pp_is_recruiter_role(social.job_title);
