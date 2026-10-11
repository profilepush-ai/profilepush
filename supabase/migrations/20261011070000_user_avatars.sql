/*
# Your own avatar in your match pictures

Opt-in. A user makes a stylized avatar from their Google photo or one they
upload (my-avatar function), sees it, and taps "Use in my pictures": that tap
is their consent (consented_at). From then on, while their account has
credits or an active plan, each new job match also gets a picture of their
avatar holding the job's skills, made for them alone (match_visuals_me).
With no credits they see the standard pictures, so the avatar doubles as a
sign of their credit status. Removing the avatar deletes those pictures.

Consultant profiles keep pictures with no people, so a viewer's face never
stands in for a candidate.
*/

create table if not exists public.user_avatars (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'making' check (status in ('making', 'ready', 'active', 'failed')),
  source text check (source in ('google', 'upload')),
  url text,
  error text,
  consented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_avatars enable row level security;
drop policy if exists user_avatars_own on public.user_avatars;
create policy user_avatars_own on public.user_avatars for select to authenticated using (user_id = auth.uid());

create table if not exists public.match_visuals_me (
  lead_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'pending', 'done', 'failed')),
  url text,
  prompt text,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lead_id, user_id)
);
create index if not exists match_visuals_me_queue_idx on public.match_visuals_me (created_at desc) where status <> 'done';
alter table public.match_visuals_me enable row level security;
drop policy if exists match_visuals_me_own on public.match_visuals_me;
create policy match_visuals_me_own on public.match_visuals_me for select to authenticated using (user_id = auth.uid());

-- The scene of a job without its person, so the viewer's avatar can step in.
alter table public.match_visuals add column if not exists template text;

-- Avatars show while the account has credits or an active plan.
create or replace function public.pp_avatar_on(p_account uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select a.credits_balance from public.accounts a where a.id = p_account), 0) > 0
    or exists (select 1 from public.subscriptions s where s.account_id = p_account and s.status = 'active')
$$;
revoke all on function public.pp_avatar_on(uuid) from public, anon, authenticated;

-- Queue a user's own pictures for job posts.
create or replace function public.queue_my_visuals(p_user uuid, p_leads uuid[])
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_n integer;
begin
  insert into public.match_visuals_me (lead_id, user_id)
  select distinct unnest(p_leads), p_user
  on conflict (lead_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.queue_my_visuals(uuid, uuid[]) from public, anon, authenticated;

-- When a user turns their avatar on: their job matches now in Today.
create or replace function public.queue_my_today(p_user uuid)
returns integer language sql security definer set search_path to 'public' as $$
  select public.queue_my_visuals(p_user, array(
    select c.lead_id from public.pipeline_cards c
    where c.account_id = public.publisher_account_for_user(p_user)
      and c.lead_kind = 'job' and c.stage = 'new' and c.saved_at is null
      and c.added_at > now() - interval '24 hours'))
$$;
revoke all on function public.queue_my_today(uuid) from public, anon, authenticated;

-- Every new match queues its post's pictures, and (job posts) a picture
-- for each member of the account whose avatar is on.
create or replace function public.match_visuals_on_card()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.queue_match_visuals(new.lead_kind, new.lead_id);
  if new.lead_kind = 'job' and public.pp_avatar_on(new.account_id) then
    insert into public.match_visuals_me (lead_id, user_id)
    select new.lead_id, am.user_id
    from public.account_members am
    join public.user_avatars u on u.user_id = am.user_id and u.status = 'active'
    where am.account_id = new.account_id and am.status = 'active'
    on conflict (lead_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

-- The worker's share of personal pictures, newest first.
create or replace function public.claim_my_visuals(p_limit integer)
returns setof public.match_visuals_me language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  update public.match_visuals_me m set status = 'pending', attempts = m.attempts + 1, error = null, updated_at = now()
  where (m.lead_id, m.user_id) in (
    select q.lead_id, q.user_id from public.match_visuals_me q
    join public.user_avatars u on u.user_id = q.user_id and u.status = 'active'
    where q.status = 'queued'
       or (q.status = 'pending' and q.updated_at < now() - interval '10 minutes' and q.attempts < 3)
       or (q.status = 'failed' and q.attempts < 3 and q.updated_at < now() - interval '30 minutes')
    order by q.created_at desc
    limit greatest(1, least(p_limit, 50))
    for update of q skip locked)
  returning m.*;
end;
$$;
revoke all on function public.claim_my_visuals(integer) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pp_card_item_json(c pipeline_cards)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    -- The viewer's own picture of this post, drawn with their avatar.
    'my_visual', (select m.url from public.match_visuals_me m where m.lead_id = c.lead_id and m.user_id = auth.uid() and m.url is not null),
    'card_id', c.id, 'subject_id', c.subject_id, 'lead_id', c.lead_id, 'subject_kind', c.subject_kind,
    'fit', c.fit_score, 'similarity', round(c.similarity::numeric, 3),
    'stage', c.stage, 'closed_reason', c.closed_reason,
    'viewed_at', c.viewed_at, 'saved_at', c.saved_at, 'applied_at', c.applied_at, 'added_at', c.added_at,
    'reply_in_inbox', c.conversation_id is not null and exists (
      select 1 from public.vendor_messages m where m.conversation_id = c.conversation_id and m.direction = 'inbound'),
    'how', case when c.subject_kind = 'hotlist' and exists (
      select 1 from public.external_applications ea where ea.account_id = c.account_id and ea.social_job_id = c.lead_id) then 'site' else 'email' end,
    'subject', case when c.subject_kind = 'hotlist'
      then (select jsonb_build_object(
          'id', h.id, 'title', h.role_title, 'name', h.candidate_name, 'visa', h.visa_type,
          'locations', to_jsonb(h.locations), 'years', h.years_experience, 'skills', to_jsonb(h.core_skills),
          'rate_min', h.hourly_rate_min, 'rate_max', h.hourly_rate_max, 'posted_at', coalesce(h.posted_at, h.created_at),
          'resumes', (
            select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'url', f.url, 'file_name', f.file_name, 'is_default', f.url = r.url)
              order by (f.url = r.url) desc nulls last, f.uploaded_at desc), '[]'::jsonb)
            from public.hotlist_resume_files f left join public.hotlist_resumes r on r.hotlist_id = f.hotlist_id
            where f.hotlist_id = h.id),
          'locked', 0, 'applied_today', 0)
        from public.social_hotlist h where h.id = c.subject_id)
      else (select jsonb_build_object(
          'id', j.id, 'title', j.job_title, 'location', j.location, 'skills', coalesce(j.extracted_skills, '[]'::jsonb),
          'visas', coalesce(j.extracted_visa_types, '[]'::jsonb), 'rate_min', j.extracted_hourly_rate_min,
          'rate_max', j.extracted_hourly_rate_max, 'years', j.extracted_experience_years, 'posted_at', coalesce(j.posted_at, j.created_at),
          'locked', 0, 'applied_today', 0)
        from public.social_jobs j where j.id = c.subject_id) end,
    'lead', case when c.lead_kind = 'job'
      then (select public.pp_job_card_json(j) from public.social_jobs j where j.id = c.lead_id)
      else (select public.pp_profile_card_json(h) from public.social_hotlist h where h.id = c.lead_id) end
  )
$function$;
revoke all on function public.pp_card_item_json(public.pipeline_cards) from public, anon, authenticated;

create or replace function public.get_today(p_kind text default 'hotlist', p_tz text default 'UTC')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_kind text := case when p_kind = 'job' then 'job' else 'hotlist' end;
  v_day timestamptz := public.pp_day_start(p_tz);
  v_utc_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_is_trial boolean;
  v_target integer;
  v_subjects jsonb;
  v_items jsonb;
begin
  if v_account is null then return null; end if;
  select coalesce(a.is_trial, true), a.daily_submission_target into v_is_trial, v_target from public.accounts a where a.id = v_account;

  if v_kind = 'hotlist' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'title', h.role_title, 'name', h.candidate_name, 'visa', h.visa_type,
      'locations', to_jsonb(h.locations), 'years', h.years_experience, 'skills', to_jsonb(h.core_skills),
      'rate_min', h.hourly_rate_min, 'rate_max', h.hourly_rate_max, 'posted_at', coalesce(h.posted_at, h.created_at),
      'resumes', (
        select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'url', f.url, 'file_name', f.file_name, 'is_default', f.url = r.url)
          order by (f.url = r.url) desc nulls last, f.uploaded_at desc), '[]'::jsonb)
        from public.hotlist_resume_files f left join public.hotlist_resumes r on r.hotlist_id = f.hotlist_id
        where f.hotlist_id = h.id),
      'locked', (select count(*) from public.pipeline_waiting_matches w where w.subject_id = h.id),
      'applied_today', (select count(*) from public.pipeline_cards c where c.subject_id = h.id and c.applied_at >= v_day)
    ) order by coalesce(h.posted_at, h.created_at) desc), '[]'::jsonb)
    into v_subjects
    from public.social_hotlist h
    where h.created_by_account_id = v_account and h.post_source = 'user_post'
      and coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id, 'title', j.job_title, 'location', j.location, 'skills', coalesce(j.extracted_skills, '[]'::jsonb),
      'visas', coalesce(j.extracted_visa_types, '[]'::jsonb), 'rate_min', j.extracted_hourly_rate_min,
      'rate_max', j.extracted_hourly_rate_max, 'years', j.extracted_experience_years, 'posted_at', coalesce(j.posted_at, j.created_at),
      'locked', (select count(*) from public.pipeline_waiting_matches w where w.subject_id = j.id),
      'applied_today', (select count(*) from public.pipeline_cards c where c.subject_id = j.id and c.applied_at >= v_day)
    ) order by coalesce(j.posted_at, j.created_at) desc), '[]'::jsonb)
    into v_subjects
    from public.social_jobs j
    where j.created_by_account_id = v_account and j.post_source = 'user_post'
      and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null;
  end if;

  with picked as (
    select c.id, c.lead_id, c.fit_score, c.added_at
    from public.pipeline_cards c
    left join public.social_jobs j on c.lead_kind = 'job' and j.id = c.lead_id
    left join public.social_hotlist h on c.lead_kind = 'hotlist' and h.id = c.lead_id
    where c.account_id = v_account and c.subject_kind = v_kind and c.stage = 'new' and c.saved_at is null
      and c.added_at > now() - interval '24 hours'
      and (
        (c.lead_kind = 'job' and j.id is not null and j.hidden_at is null and coalesce(j.post_status, 'open') = 'open'
          and coalesce(j.posted_at, j.created_at) > now() - interval '14 days')
        or (c.lead_kind = 'hotlist' and h.id is not null and h.hidden_at is null and coalesce(h.post_status, 'open') = 'open')
      )
    order by c.fit_score desc nulls last, c.added_at desc
    limit 400
  )
  , eng as (
    select * from public.pp_lead_engagement(array(select k.lead_id from picked k))
  )
  -- Most viewed first (what everyone else is looking at), then the best fit.
  select coalesce(jsonb_agg(public.pp_card_item_json(p) || jsonb_build_object(
      'duplicate', case when v_kind = 'hotlist' then public.submission_duplicate(v_account, p.subject_id, p.lead_id) end,
      'eng', jsonb_build_object('views', coalesce(e.views, 0), 'applies', coalesce(e.applies, 0), 'saves', coalesce(e.saves, 0), 'shares', coalesce(e.shares, 0)))
    order by coalesce(e.views, 0) desc, k.fit_score desc nulls last, k.added_at desc), '[]'::jsonb)
  into v_items
  from picked k join public.pipeline_cards p on p.id = k.id left join eng e on e.lead_id = k.lead_id;

  return jsonb_build_object(
    'kind', v_kind,
    'day_start', v_day,
    'target', v_target,
    'daily_cap', case when v_is_trial then 10 else 100 end,
    'used_today', (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.created_at >= v_utc_day),
    'applied_today', (select count(*) from public.pipeline_cards c where c.account_id = v_account and c.subject_kind = v_kind and c.applied_at >= v_day),
    'subjects', v_subjects,
    'items', v_items,
    'reel', public.pp_reel_stats(v_account, v_kind, p_tz),
    'avatar_on', public.pp_avatar_on(v_account)
  );
end;
$$;
