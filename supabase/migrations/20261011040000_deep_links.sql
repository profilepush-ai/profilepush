/*
# Every push and email opens the right place

Match alerts used to open /tracker, which now lists applications only. Now:
- /today?card=<card id> opens Today's reel right on that match. A link
  carrying only a post (?lead=<post id>, from emails built before cards) opens
  the match for that post.
- pp_card_route() sends a match that has left Today to where it went:
  Tracker (applied), History (saved / viewed), or the post's own page.
- The in-app/push match alert opens the best new match, and says jobs and
  profiles. The evening nudge email's items carry their card ids.
- Chat notifications linked to /posts/messages/<thread>, a page that doesn't
  exist; they now open /inbox/<thread> (old ones too).
*/

create or replace function public.pp_card_route(p_card uuid, p_lead uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  c public.pipeline_cards;
  v_lead uuid := p_lead;
  v_kind text;
begin
  if v_account is null then return '/today'; end if;
  select * into c from public.pipeline_cards x
  where x.account_id = v_account and (x.id = p_card or (p_card is null and x.lead_id = p_lead))
  order by x.added_at desc limit 1;
  if found then
    if c.applied_at is not null or c.stage in ('submitted', 'replied', 'interview', 'placed') then
      return case when c.stage = 'closed' then '/history?tab=applied' else '/tracker' end;
    end if;
    if c.saved_at is not null then return '/history?tab=saved'; end if;
    if c.viewed_at is not null then return '/history?tab=viewed'; end if;
    v_lead := c.lead_id;
    v_kind := c.lead_kind;
  end if;
  if v_lead is null then return '/today'; end if;
  v_kind := coalesce(v_kind,
    case when exists (select 1 from public.social_jobs j where j.id = v_lead) then 'job'
         when exists (select 1 from public.social_hotlist h where h.id = v_lead) then 'hotlist' end);
  return case v_kind when 'job' then '/job/' || v_lead when 'hotlist' then '/hotlist/' || v_lead else '/today' end;
end;
$$;
revoke all on function public.pp_card_route(uuid, uuid) from public, anon;
grant execute on function public.pp_card_route(uuid, uuid) to authenticated;

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
      select c.id, c.account_id, c.subject_kind, c.subject_id, c.lead_kind, c.lead_id, c.fit_score, c.similarity
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
      (array_agg(f.lead_id) filter (where f.lead_kind = 'job'))[1:3] as job_leads,
      -- The best new match: the alert opens Today right on it.
      (array_agg(f.id order by f.fit_score desc nulls last, f.similarity desc))[1] as top_card
    from fresh f
    group by f.account_id
  loop
    v_title := null;
    v_body := null;
    if a.kind = 'hotlist' then
      -- Bench sales: jobs for their profiles.
      v_title := a.n || ' new job' || case when a.n = 1 then '' else 's' end
        || ' for ' || case when a.subjects = 1 then 'your profile' else a.subjects || ' of your profiles' end;
      select string_agg(coalesce(nullif(trim(j.job_title), ''), 'Job'), ' · ') into v_body
      from public.social_jobs j where j.id = any(a.job_leads);
    else
      -- Vendors: profiles for their job (named by its own title).
      select 'New profiles for ' || coalesce(nullif(trim(j.job_title), ''), 'your job') into v_title
      from public.social_jobs j where j.id = a.top_subject;
      v_title := a.n || ' ' || lower(left(coalesce(v_title, 'New profiles for your job'), 1))
        || substr(coalesce(v_title, 'New profiles for your job'), 2);
      v_body := case when a.subjects > 1 then 'And matches for ' || (a.subjects - 1) || ' more of your jobs. ' else '' end
        || 'Open Today to see them and ask for resumes.';
    end if;

    insert into public.notifications (account_id, user_id, type, title, body, link, read)
    select a.account_id, am.user_id, 'tracker_new_matches',
      left(coalesce(v_title, a.n || ' new matches'), 200), left(coalesce(v_body, ''), 300), '/today?card=' || a.top_card, false
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
    select e.user_id, c.id, c.subject_kind, c.subject_id, c.lead_id, c.created_at
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
      select coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'detail', x.detail, 'card', x.card)), '[]'::jsonb) from (
        select coalesce(nullif(trim(j.job_title), ''), 'Job') as title, nullif(trim(j.location), '') as detail, f.id as card
        from fresh f join public.social_jobs j on j.id = f.lead_id
        where f.user_id = e.user_id order by f.created_at desc limit 5
      ) x)
    else (
      select coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'detail', x.detail, 'card', x.card)), '[]'::jsonb) from (
        select coalesce(nullif(trim(j.job_title), ''), 'Your job') as title, count(*) || ' new profile' || case when count(*) = 1 then '' else 's' end as detail,
          (array_agg(f.id order by f.created_at desc))[1] as card
        from fresh f join public.social_jobs j on j.id = f.subject_id
        where f.user_id = e.user_id group by j.id, j.job_title order by count(*) desc limit 5
      ) x)
    end
  from eligible e join counts k on k.user_id = e.user_id;
$function$;

-- Chat notifications: the thread opens in Inbox.
create or replace function public.notifications_fix_link()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.link like '/posts/messages/%' then
    new.link := '/inbox/' || substr(new.link, length('/posts/messages/') + 1);
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_fix_link on public.notifications;
create trigger notifications_fix_link before insert or update of link on public.notifications
  for each row execute function public.notifications_fix_link();
update public.notifications set link = '/inbox/' || substr(link, length('/posts/messages/') + 1) where link like '/posts/messages/%';
update public.notifications set link = '/today' where type = 'tracker_new_matches' and link = '/tracker';
