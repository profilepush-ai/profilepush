-- Tracker nudge email: weekdays at 18:30 UTC (5 hours after the morning
-- brief), for people active in the last 14 days who haven't opened ProfilePush
-- since the brief and have at least 3 new strong matches (similarity >= 0.70)
-- that landed after it. Same suppression rules as the morning brief (email
-- off, bounced/complained, app users get push instead), at most one per 20
-- hours. Never names a consultant: bench lists requirement titles, vendors
-- get counts per their own requirement.
create or replace function public.get_tracker_nudges()
returns table (
  user_id uuid, account_id uuid, email text, first_name text, persona text,
  new_count integer, subjects integer, items jsonb
)
language sql
stable
security definer
set search_path = public
as $$
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
$$;
revoke all on function public.get_tracker_nudges() from public, anon, authenticated;
grant execute on function public.get_tracker_nudges() to service_role;
