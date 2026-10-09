/*
# Submission queue: fresh requirements first

Requirements older than 14 days are left out of the queue (usually filled);
the last 3 days come first, then the strongest matches.
*/
create or replace function public.get_submission_queue(p_per_subject integer default 25)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_account uuid;
  v_is_trial boolean;
  v_target integer;
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_result jsonb;
begin
  select am.account_id into v_account from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1;
  if v_account is null then return null; end if;
  select coalesce(a.is_trial, true), a.daily_submission_target into v_is_trial, v_target from public.accounts a where a.id = v_account;

  with subjects as (
    select h.id, h.role_title, h.candidate_name, h.visa_type, h.locations, h.years_experience, h.core_skills,
      h.hourly_rate_min, h.hourly_rate_max, coalesce(h.posted_at, h.created_at) as at,
      r.url as resume_url, r.file_name as resume_file_name
    from public.social_hotlist h
    left join public.hotlist_resumes r on r.hotlist_id = h.id
    where h.created_by_account_id = v_account and h.post_source = 'user_post'
      and coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null
  ),
  items as (
    select c.subject_id, c.id as card_id, j.id as job_id, j.job_title, j.posted_by_name, j.company_name, j.location,
      j.salary_range, j.extracted_hourly_rate_min, j.extracted_hourly_rate_max, j.post_source, j.post_url,
      coalesce(j.posted_at, j.created_at) as posted_at, c.similarity,
      coalesce(btrim(j.poster_email), '') <> '' as has_email,
      -- Last 3 days first, then by match; C2C requirements older than
      -- 14 days are usually filled, so they are left out.
      row_number() over (partition by c.subject_id
        order by (coalesce(j.posted_at, j.created_at) > now() - interval '3 days') desc, c.similarity desc, coalesce(j.posted_at, j.created_at) desc) as rn
    from public.pipeline_cards c
    join subjects s on s.id = c.subject_id
    join public.social_jobs j on j.id = c.lead_id
    where c.account_id = v_account and c.subject_kind = 'hotlist' and c.stage = 'new'
      and j.hidden_at is null and coalesce(j.post_status, 'open') = 'open'
      and coalesce(j.posted_at, j.created_at) > now() - interval '14 days'
  )
  select jsonb_build_object(
    'target', v_target,
    'daily_cap', case when v_is_trial then 10 else 100 end,
    'used_today', (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.created_at >= v_day),
    'submitted_today',
      (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.created_at >= v_day
         and r.job_id is not null and r.status in ('completed', 'fulfilled'))
      + (select count(*) from public.external_applications a where a.account_id = v_account and a.created_at >= v_day),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_id', s.id, 'role_title', s.role_title, 'candidate_name', s.candidate_name, 'visa_type', s.visa_type,
        'location', s.locations[1], 'years_experience', s.years_experience, 'skills', to_jsonb(s.core_skills[1:6]),
        'resume_url', s.resume_url, 'resume_file_name', s.resume_file_name,
        'submitted_today',
          (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.subject_hotlist_id = s.id
             and r.created_at >= v_day and r.status in ('completed', 'fulfilled'))
          + (select count(*) from public.external_applications a where a.account_id = v_account and a.subject_id = s.id and a.created_at >= v_day),
        'waiting', (select count(*) from items i where i.subject_id = s.id),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'card_id', i.card_id, 'job_id', i.job_id, 'title', i.job_title, 'poster', i.posted_by_name, 'company', i.company_name,
            'location', i.location, 'pay', nullif(i.salary_range, ''), 'rate_min', i.extracted_hourly_rate_min, 'rate_max', i.extracted_hourly_rate_max,
            'source', i.post_source, 'apply_url', case when i.post_source = 'career_site' then i.post_url end,
            'posted_at', i.posted_at, 'similarity', round(i.similarity::numeric, 3), 'has_email', i.has_email,
            'duplicate', public.submission_duplicate(v_account, s.id, i.job_id)
          ) order by i.rn)
          from items i where i.subject_id = s.id and i.rn <= p_per_subject
        ), '[]'::jsonb)
      ) order by s.at desc)
      from subjects s
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
