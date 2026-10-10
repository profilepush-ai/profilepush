/*
# AI Matches on/off, and unopened matches expire after 7 days

1. accounts.auto_match_enabled (default on), switched from the Tracker header.
   Off: the matcher and rematch add no matches for the account, and no match
   notifications or match emails go out.
2. Opening a job's post records it (post_content_unlocks, now an "opened"
   ledger; opening stays free).
3. A match still in New 7 days after it arrived, never opened, moves to Closed
   as "expired" (daily, 02:30 UTC). Its credit is not refunded.
*/

alter table public.accounts add column if not exists auto_match_enabled boolean not null default true;

create or replace function public.set_auto_match(p_enabled boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.accounts set auto_match_enabled = p_enabled
  where id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active');
end;
$$;
revoke all on function public.set_auto_match(boolean) from public, anon;
grant execute on function public.set_auto_match(boolean) to authenticated;

-- Opening a job post is free and recorded, so an unopened match can expire.
create or replace function public.open_post_content(p_kind text, p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_content text;
  v_account uuid;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'unauthorized'); end if;
  if p_kind = 'hotlist' then
    select h.raw_post_content into v_content from public.social_hotlist h where h.id = p_lead_id;
  else
    select coalesce(nullif(btrim(j.post_content), ''), j.job_description) into v_content from public.social_jobs j where j.id = p_lead_id;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
    select am.account_id into v_account from public.account_members am
    where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1;
    if v_account is not null then
      insert into public.post_content_unlocks (account_id, job_id) values (v_account, p_lead_id) on conflict do nothing;
    end if;
  end if;
  return jsonb_build_object('content', coalesce(v_content, ''), 'charged', false);
end;
$$;

create or replace function public.expire_unopened_matches()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_n integer;
begin
  update public.pipeline_cards c
  set stage = 'closed', closed_reason = 'expired', stage_changed_at = now(), updated_at = now()
  where c.stage = 'new' and c.added_at < now() - interval '7 days'
    and not exists (select 1 from public.post_content_unlocks u where u.account_id = c.account_id and u.job_id = c.lead_id)
    and not exists (
      select 1 from public.pulse_lead_actions a
      where a.account_id = c.account_id and a.lead_id = c.lead_id::text and a.action_type = 'post_content_viewed'
    );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.expire_unopened_matches() from public, anon, authenticated;

select cron.unschedule('expire-unopened-matches') where exists (select 1 from cron.job where jobname = 'expire-unopened-matches');
select cron.schedule('expire-unopened-matches', '30 2 * * *', 'select public.expire_unopened_matches();');

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
      coalesce(pa.match_min_score, 70) as pref,
      case when h.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_hotlist h
    left join public.accounts pa on pa.id = h.created_by_account_id
    where h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
      and h.created_by_account_id is not null and h.hotlist_embedding is not null
      and coalesce(pa.auto_match_enabled, true)
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
      l.extracted_visa_types, l.post_content, l.location, s.visa_type, s.locations, s.candidate_summary,
      coalesce(s.non_it, false) as non_it, s.pref
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
      and coalesce(s.non_it, false) = coalesce(l.non_it, false)
  ),
  ranked as (
    select p.account_id, p.subject_id, p.lead_id, p.sim,
      row_number() over (partition by p.subject_id order by p.sim desc) as rn
    from pairs p
    where p.sim >= public.pp_match_min_sim(p.pref, p.non_it)
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
      coalesce(pa.match_min_score, 70) as pref,
      case when j.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_jobs j
    left join public.accounts pa on pa.id = j.created_by_account_id
    where j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
      and j.created_by_account_id is not null and j.job_embedding is not null
      and coalesce(pa.auto_match_enabled, true)
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
      s.extracted_visa_types, s.post_content, s.location, l.visa_type, l.locations, l.candidate_summary, s.pref
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
  ),
  ranked as (
    select p.account_id, p.subject_id, p.lead_id, p.sim,
      row_number() over (partition by p.subject_id order by p.sim desc) as rn
    from pairs p
    where p.sim >= public.pp_match_min_sim(p.pref, false)
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

  -- AI Matches switched off on the Tracker: no new matches.
  if exists (select 1 from public.accounts a where a.id = any(v_accounts) and not a.auto_match_enabled) then
    return 0;
  end if;

  if exists (select 1 from public.social_hotlist h where h.id = p_subject_id and h.created_by_account_id = any(v_accounts)) then
    with s as (
      select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb, h.visa_type, h.locations, h.candidate_summary,
        coalesce(h.job_category = 'Non-IT', false) as non_it,
        coalesce((select a.match_min_score from public.accounts a where a.id = h.created_by_account_id), 70) as pref
      from public.social_hotlist h where h.id = p_subject_id and h.hotlist_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, j.id as lead_id, (1 - (s.emb <=> j.job_embedding))::real as sim,
        j.extracted_visa_types, j.post_content, j.location, s.visa_type, s.locations, s.candidate_summary, s.non_it, s.pref
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
    where sim >= public.pp_match_min_sim(pref, non_it)
      and public.pp_pair_ok(extracted_visa_types, post_content, location, visa_type, locations, candidate_summary)
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_added = row_count;
  elsif exists (select 1 from public.social_jobs j where j.id = p_subject_id and j.created_by_account_id = any(v_accounts)) then
    with s as (
      select j.id, j.created_by_account_id as account_id, j.job_embedding as emb, j.extracted_visa_types, j.post_content, j.location,
        coalesce((select a.match_min_score from public.accounts a where a.id = j.created_by_account_id), 70) as pref
      from public.social_jobs j where j.id = p_subject_id and j.job_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, h.id as lead_id, (1 - (s.emb <=> h.hotlist_embedding))::real as sim,
        s.extracted_visa_types, s.post_content, s.location, h.visa_type, h.locations, h.candidate_summary, s.pref
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
    where sim >= public.pp_match_min_sim(pref, false)
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

CREATE OR REPLACE FUNCTION public.notify_new_tracker_matches()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a record;
  v_sent integer := 0;
  v_title text;
  v_body text;
begin
  for a in
    with fresh as (
      select c.account_id, c.subject_kind, c.subject_id, c.lead_kind, c.lead_id
      from public.pipeline_cards c
      join public.accounts acc on acc.id = c.account_id and acc.auto_match_enabled
      left join public.tracker_alert_state s on s.account_id = c.account_id
      where c.stage = 'new' and c.similarity >= 0.70
        and c.created_at > greatest(coalesce(s.last_alert_at, now() - interval '1 hour'), now() - interval '1 hour')
        and (s.last_alert_at is null or s.last_alert_at < now() - interval '60 minutes')
        and (s.alert_day is distinct from current_date or s.alerts_today < 8)
    )
    select f.account_id, max(f.subject_kind) as kind, count(*)::integer as n,
      count(distinct f.subject_id)::integer as subjects,
      (array_agg(f.subject_id order by f.subject_id) filter (where f.subject_kind = 'job'))[1] as top_subject,
      (array_agg(f.lead_id) filter (where f.lead_kind = 'job'))[1:3] as job_leads
    from fresh f
    group by f.account_id
  loop
    v_title := null;
    v_body := null;
    if a.kind = 'hotlist' then
      -- Bench sales: requirements for their consultants.
      v_title := a.n || ' new requirement' || case when a.n = 1 then '' else 's' end
        || ' for ' || case when a.subjects = 1 then 'your consultant' else a.subjects || ' of your consultants' end;
      select string_agg(coalesce(nullif(trim(j.job_title), ''), 'Requirement'), ' · ') into v_body
      from public.social_jobs j where j.id = any(a.job_leads);
    else
      -- Vendors: consultants for their requirement (named by its own title).
      select 'New consultants for ' || coalesce(nullif(trim(j.job_title), ''), 'your requirement') into v_title
      from public.social_jobs j where j.id = a.top_subject;
      v_title := a.n || ' ' || lower(left(coalesce(v_title, 'New consultants for your requirement'), 1))
        || substr(coalesce(v_title, 'New consultants for your requirement'), 2);
      v_body := case when a.subjects > 1 then 'And matches for ' || (a.subjects - 1) || ' more of your requirements. ' else '' end
        || 'Open your Tracker to request resumes.';
    end if;

    insert into public.notifications (account_id, user_id, type, title, body, link, read)
    select a.account_id, am.user_id, 'tracker_new_matches',
      left(coalesce(v_title, a.n || ' new Tracker matches'), 200), left(coalesce(v_body, ''), 300), '/tracker', false
    from public.account_members am
    where am.account_id = a.account_id and am.status = 'active' and am.user_id is not null;

    insert into public.tracker_alert_state (account_id, last_alert_at, alert_day, alerts_today)
    values (a.account_id, now(), current_date, 1)
    on conflict (account_id) do update set
      last_alert_at = now(),
      alerts_today = case when tracker_alert_state.alert_day = current_date then tracker_alert_state.alerts_today + 1 else 1 end,
      alert_day = current_date;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_tracker_nudges()
 RETURNS TABLE(user_id uuid, account_id uuid, email text, first_name text, persona text, new_count integer, subjects integer, items jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with recipients as (
    select distinct on (u.id)
      u.id as user_id, am.account_id, u.email::text as email,
      nullif(initcap(split_part(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ' ', 1)), '') as first_name,
      a.active_persona::text as persona,
      (select max(d.last_activity_at) from public.user_activity_daily d where d.user_id = u.id) as last_seen
    from auth.users u
    join public.account_members am on am.user_id = u.id and am.status = 'active'
    join public.accounts a on a.id = am.account_id
    where u.email is not null and u.email_confirmed_at is not null
      and a.auto_match_enabled
      and not exists (select 1 from public.notification_preferences np where np.user_id = u.id and np.notif_type = 'daily_digest' and np.email_enabled = false)
      and not exists (select 1 from public.email_sends s where lower(s.to_email) = lower(u.email) and (s.complained_at is not null or s.bounce_type like 'Permanent%'))
      and not exists (select 1 from public.user_app_installs i where i.user_id = u.id and i.last_seen_at > now() - interval '7 days')
      and not exists (select 1 from public.email_sends s where lower(s.to_email) = lower(u.email) and s.category = 'tracker_nudge' and s.created_at > now() - interval '20 hours')
    order by u.id, am.created_at asc
  ),
  eligible as (
    select r.* from recipients r
    where r.last_seen > now() - interval '14 days'
      and r.last_seen < now() - interval '5 hours'
  ),
  fresh as (
    select e.user_id, c.subject_kind, c.subject_id, c.lead_id, c.created_at
    from eligible e
    join public.pipeline_cards c on c.account_id = e.account_id
    where c.stage = 'new' and c.similarity >= 0.70
      and c.created_at > greatest(e.last_seen, now() - interval '5 hours')
  ),
  counts as (
    select f.user_id, count(*)::integer as n, count(distinct f.subject_id)::integer as subjects, max(f.subject_kind) as kind
    from fresh f group by f.user_id having count(*) >= 3
  )
  select e.user_id, e.account_id, e.email, e.first_name, e.persona, k.n, k.subjects,
    case when k.kind = 'hotlist' then (
      select coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'detail', x.detail)), '[]'::jsonb) from (
        select coalesce(nullif(trim(j.job_title), ''), 'Requirement') as title, nullif(trim(j.location), '') as detail
        from fresh f join public.social_jobs j on j.id = f.lead_id
        where f.user_id = e.user_id order by f.created_at desc limit 5
      ) x)
    else (
      select coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'detail', x.detail)), '[]'::jsonb) from (
        select coalesce(nullif(trim(j.job_title), ''), 'Your requirement') as title, count(*) || ' new consultant' || case when count(*) = 1 then '' else 's' end as detail
        from fresh f join public.social_jobs j on j.id = f.subject_id
        where f.user_id = e.user_id group by j.id, j.job_title order by count(*) desc limit 5
      ) x)
    end
  from eligible e join counts k on k.user_id = e.user_id;
$function$;
