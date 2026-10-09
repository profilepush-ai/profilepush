/*
# Daily submission queue

Bench recruiters work to a daily target (often 100 submissions). This adds:

1. subject_hotlist_id on pulse_ask_ai_requests and vendor_conversations: the
   consultant a submission was for. Sends without it (older AI Submit, resume
   requests) keep their account-wide behaviour.
2. Tracker triggers that respect it: a submission moves only that
   consultant's card, and a new card for another consultant starts as New.
3. accounts.daily_submission_target (default 100).
4. submission_duplicate(account, consultant, job): why this consultant should
   not be sent to this job again (same job, or the same requirement reposted,
   or already applied), or null.
5. get_submission_queue(): the caller's consultants with today's matches to
   act on, counts toward the target, and the daily send cap.
*/

alter table public.pulse_ask_ai_requests add column if not exists subject_hotlist_id uuid;
alter table public.vendor_conversations add column if not exists subject_hotlist_id uuid;
create index if not exists pulse_ask_ai_requests_subject_idx
  on public.pulse_ask_ai_requests (account_id, subject_hotlist_id, created_at desc) where subject_hotlist_id is not null;

alter table public.pulse_ask_ai_requests drop constraint if exists pulse_ask_ai_requests_send_source_check;
alter table public.pulse_ask_ai_requests add constraint pulse_ask_ai_requests_send_source_check
  check (send_source = any (array['single'::text, 'bulk'::text, 'queue'::text]));

alter table public.accounts add column if not exists daily_submission_target integer not null default 100
  check (daily_submission_target between 1 and 1000);

create or replace function public.pipeline_card_on_vendor_message()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_conv public.vendor_conversations%rowtype;
begin
  select * into v_conv from public.vendor_conversations where id = new.conversation_id;
  if not found then return new; end if;
  if new.direction = 'outbound' then
    update public.pipeline_cards c
    set stage = 'submitted', stage_changed_at = now(), updated_at = now(), conversation_id = v_conv.id
    where c.account_id = v_conv.account_id
      and c.lead_id = coalesce(v_conv.job_id, v_conv.hotlist_id)
      and (v_conv.subject_hotlist_id is null or c.subject_id = v_conv.subject_hotlist_id)
      and c.stage = 'new';
  elsif new.direction = 'inbound' then
    update public.pipeline_cards c
    set stage = 'replied', stage_changed_at = now(), updated_at = now(), conversation_id = v_conv.id
    where c.account_id = v_conv.account_id
      and c.lead_id = coalesce(v_conv.job_id, v_conv.hotlist_id)
      and (v_conv.subject_hotlist_id is null or c.subject_id = v_conv.subject_hotlist_id)
      and c.stage in ('new', 'submitted');
  end if;
  return new;
end;
$$;

create or replace function public.pipeline_card_on_ask_request()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(new.hotlist_id, new.job_id) is not null and new.status in ('completed', 'fulfilled') then
    update public.pipeline_cards c
    set stage = 'submitted', stage_changed_at = now(), updated_at = now()
    where c.account_id = new.account_id and c.lead_id = coalesce(new.hotlist_id, new.job_id)
      and (new.subject_hotlist_id is null or c.subject_id = new.subject_hotlist_id)
      and c.stage = 'new';
  end if;
  return new;
end;
$$;

create or replace function public.pipeline_card_start_stage()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_conv uuid;
  v_at timestamptz;
begin
  if new.stage <> 'new' then return new; end if;

  -- A send for a named consultant only counts for that consultant's card.
  select vc.id, min(m.created_at) into v_conv, v_at
  from public.vendor_conversations vc
  join public.vendor_messages m on m.conversation_id = vc.id and m.direction = 'outbound'
  where vc.account_id = new.account_id and coalesce(vc.job_id, vc.hotlist_id) = new.lead_id
    and (vc.subject_hotlist_id is null or vc.subject_hotlist_id = new.subject_id)
  group by vc.id
  order by min(m.created_at)
  limit 1;

  if v_conv is null then
    select min(x.at) into v_at from (
      select a.created_at as at from public.job_applications a
        where a.created_by_account_id = new.account_id and a.social_job_id = new.lead_id
      union all
      select r.created_at from public.pulse_ask_ai_requests r
        where r.account_id = new.account_id and coalesce(r.hotlist_id, r.job_id) = new.lead_id and r.status in ('completed', 'fulfilled')
          and (r.subject_hotlist_id is null or r.subject_hotlist_id = new.subject_id)
      union all
      select t.created_at from public.post_chat_threads t
        where t.participant_account_id = new.account_id and t.hotlist_id = new.lead_id
    ) x;
    select t.id into v_conv from public.post_chat_threads t
      where t.participant_account_id = new.account_id and t.hotlist_id = new.lead_id
      order by t.created_at limit 1;
  end if;

  if v_at is not null then
    new.stage := 'submitted';
    new.stage_changed_at := v_at;
    new.conversation_id := coalesce(new.conversation_id, v_conv);
  end if;
  return new;
end;
$$;

-- Why this consultant shouldn't go to this job, or null. The same requirement
-- is often reposted by several vendors; a second submission of one consultant
-- to it gets them disqualified, so reposts (same dedup_key) count too.
create or replace function public.submission_duplicate(p_account_id uuid, p_subject_id uuid, p_job_id uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  with j as (select id, dedup_key from public.social_jobs where id = p_job_id)
  select case
    when exists (
      select 1 from public.pulse_ask_ai_requests r join j on true
      where r.account_id = p_account_id and r.subject_hotlist_id = p_subject_id
        and r.status in ('processing', 'charged', 'completed', 'fulfilled')
        and r.created_at > now() - interval '60 days'
        and r.job_id = j.id
    ) then 'Already submitted to this job'
    when exists (
      select 1 from public.pulse_ask_ai_requests r
      join public.social_jobs sj on sj.id = r.job_id
      join j on sj.dedup_key = j.dedup_key and j.dedup_key is not null
      where r.account_id = p_account_id and r.subject_hotlist_id = p_subject_id
        and r.status in ('processing', 'charged', 'completed', 'fulfilled')
        and r.created_at > now() - interval '60 days'
    ) then 'Already submitted to this requirement (posted by another vendor)'
    when exists (
      select 1 from public.external_applications a
      where a.account_id = p_account_id and a.subject_id = p_subject_id and a.social_job_id = p_job_id
    ) then 'Already applied on the firm''s site'
  end;
$$;
revoke all on function public.submission_duplicate(uuid, uuid, uuid) from public, anon, authenticated;

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
      row_number() over (partition by c.subject_id order by c.similarity desc, coalesce(j.posted_at, j.created_at) desc) as rn
    from public.pipeline_cards c
    join subjects s on s.id = c.subject_id
    join public.social_jobs j on j.id = c.lead_id
    where c.account_id = v_account and c.subject_kind = 'hotlist' and c.stage = 'new'
      and j.hidden_at is null and coalesce(j.post_status, 'open') = 'open'
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
revoke all on function public.get_submission_queue(integer) from public, anon;
grant execute on function public.get_submission_queue(integer) to authenticated;

create or replace function public.set_daily_submission_target(p_target integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.accounts set daily_submission_target = greatest(1, least(1000, p_target))
  where id = (select am.account_id from public.account_members am
              where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1);
end;
$$;
revoke all on function public.set_daily_submission_target(integer) from public, anon;
grant execute on function public.set_daily_submission_target(integer) to authenticated;
