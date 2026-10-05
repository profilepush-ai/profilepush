-- 1) Push delivery. The per-row trigger (push_inserted_notification) needed
-- app.supabase_url and app.service_role_key, which were never set, so no
-- notification had ever been pushed. Delivery is now a drain: every minute
-- pg_cron calls send-push-notification {mode: drain}, which pushes rows with
-- pushed_at null and marks them. Old rows are marked so nobody gets a backlog.
alter table public.notifications add column if not exists pushed_at timestamptz;
alter table public.notifications add column if not exists push_attempts integer not null default 0;
update public.notifications set pushed_at = created_at where pushed_at is null;
create index if not exists notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;
drop trigger if exists notifications_send_push on public.notifications;

select cron.unschedule(jobid) from cron.job where jobname = 'push-notifications-drain';
select cron.schedule('push-notifications-drain', '* * * * *', $cron$
  select net.http_post(
    url := 'https://nhwqcqzvotgdngtxulwi.supabase.co/functions/v1/send-push-notification',
    body := '{"mode":"drain"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od3FjcXp2b3RnZG5ndHh1bHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjY3NDQsImV4cCI6MjA5NjQ0Mjc0NH0.DCPM9hZwqEsfmStT1beaUtp3P-uDVkCZL8xv0ZFpCss'
    ),
    timeout_milliseconds := 55000
  );
$cron$);

-- 2) Tracker match alerts. After each matcher run, an account whose columns
-- got new strong matches (similarity >= 0.70; the "closest available" top-ups
-- don't count) gets one notification (bell + push), linking to the Tracker.
-- At most one an hour and 8 a day per account. Never names a consultant
-- (hotlist role titles can carry names): bench alerts count requirements,
-- vendor alerts name their own requirement.
create table if not exists public.tracker_alert_state (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  last_alert_at timestamptz,
  alert_day date,
  alerts_today integer not null default 0
);
alter table public.tracker_alert_state enable row level security;

create or replace function public.notify_new_tracker_matches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
      left join public.tracker_alert_state s on s.account_id = c.account_id
      where c.stage = 'new' and c.similarity >= 0.70
        and c.created_at > greatest(coalesce(s.last_alert_at, now() - interval '1 hour'), now() - interval '1 hour')
        and (s.last_alert_at is null or s.last_alert_at < now() - interval '60 minutes')
        and (s.alert_day is distinct from current_date or s.alerts_today < 8)
    )
    select f.account_id, max(f.subject_kind) as kind, count(*)::integer as n,
      count(distinct f.subject_id)::integer as subjects,
      (array_agg(f.subject_id order by f.subject_id))[1] as top_subject,
      (array_agg(f.lead_id) filter (where f.lead_kind = 'job'))[1:3] as job_leads
    from fresh f
    group by f.account_id
  loop
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
      v_title := a.n || ' ' || lower(left(v_title, 1)) || substr(v_title, 2);
      v_body := case when a.subjects > 1 then 'And matches for ' || (a.subjects - 1) || ' more of your requirements. ' else '' end
        || 'Open your Tracker to request resumes.';
    end if;

    insert into public.notifications (account_id, user_id, type, title, body, link, read)
    select a.account_id, am.user_id, 'tracker_new_matches', left(v_title, 200), left(coalesce(v_body, ''), 300), '/tracker', false
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
$$;
revoke all on function public.notify_new_tracker_matches() from public, anon, authenticated;

create or replace function public.run_pipeline_matcher()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_added integer;
begin
  v_added := public.refresh_pipeline_cards(interval '36 hours', now() - interval '15 minutes', interval '7 days')
           + public.fill_sparse_pipeline_columns(5, 0.50, null);
  perform public.notify_new_tracker_matches();
  return v_added;
end;
$$;
revoke all on function public.run_pipeline_matcher() from public, anon, authenticated;
