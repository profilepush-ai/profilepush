-- Tracker matcher has failed every run since 2026-10-06 00:03 UTC.
-- notify_new_tracker_matches picked an account's "kind" with max(subject_kind)
-- but its title subject from all subjects, so an account with both consultant
-- and requirement columns could get a hotlist id as top_subject. The
-- social_jobs lookup then found nothing, the title came out null, and the
-- notifications insert (title not null) aborted the whole run, so no account
-- got new cards.
--
-- Fix: take the vendor title subject from job columns only, fall back to a
-- generic title, and run the alert step in its own block so an alert failure
-- can never roll back the cards themselves.

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
  -- Alerts are best-effort: a failure here must not roll back the new cards.
  begin
    perform public.notify_new_tracker_matches();
  exception when others then
    raise warning 'notify_new_tracker_matches failed: %', sqlerrm;
  end;
  return v_added;
end;
$$;
