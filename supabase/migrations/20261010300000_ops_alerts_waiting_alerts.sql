/*
# Ops alerts, waiting-match alerts, no free post cap, refund minimum

1. check_scheduled_jobs() every 10 minutes: any scheduled job that failed in
   the last 15 minutes, a matcher run over 60s, or no successful matcher run in
   25 minutes emails profilepush.ai@gmail.com (ops-alert function), at most
   once an hour.
2. notify_waiting_matches(), after each matcher run: an account with new
   matches waiting (out of credits) gets a notification, pushed to phones,
   at most once a day.
3. The free plan's 3-open-posts cap is gone: with pay-per-match, more
   consultants mean more matches.
4. "Not a match" refunds: at least 2 per 30 days for every account, or 20% of
   paid matches if that is more.
*/

-- 3. No open-post cap.
drop trigger if exists enforce_free_post_limit on public.social_hotlist;
drop trigger if exists enforce_free_post_limit on public.social_jobs;
create or replace function public.my_open_post_allowance()
returns integer language sql stable security definer set search_path to 'public' as $$
  select null::integer;
$$;

-- 4. Refund minimum.
CREATE OR REPLACE FUNCTION public.refund_not_a_match()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_paid integer;
  v_refunded integer;
begin
  if new.stage = 'closed' and old.stage is distinct from 'closed' and new.closed_reason = 'not_a_match'
     and new.charged and not new.refunded then
    select count(*) filter (where description = 'Usage: match'), count(*) filter (where description = 'Refund: not a match')
    into v_paid, v_refunded
    from public.credit_transactions
    where account_id = new.account_id and created_at > now() - interval '30 days';
    if v_refunded < greatest(2, floor(v_paid * 0.2)) then
      new.refunded := true;
      insert into public.credit_transactions (account_id, user_id, type, amount, description)
      values (new.account_id, auth.uid(), 'refund', 1, 'Refund: not a match');
      update public.accounts set credits_balance = round(coalesce(credits_balance, 0) + 1, 4) where id = new.account_id;
    end if;
  end if;
  return new;
end;
$function$;

-- 2. Waiting-match alerts.
create table if not exists public.waiting_alert_state (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  last_alert_at timestamptz not null
);
alter table public.waiting_alert_state enable row level security;

create or replace function public.notify_waiting_matches()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  a record;
  v_sent integer := 0;
begin
  for a in
    select w.account_id, count(*)::integer as n
    from public.pipeline_waiting_matches w
    join public.accounts acc on acc.id = w.account_id and acc.auto_match_enabled
    left join public.waiting_alert_state s on s.account_id = w.account_id
    where s.last_alert_at is null or s.last_alert_at < now() - interval '24 hours'
    group by w.account_id
    having max(w.created_at) > coalesce(max(s.last_alert_at), '-infinity'::timestamptz)
  loop
    insert into public.notifications (account_id, user_id, type, title, body, link, read)
    select a.account_id, am.user_id, 'matches_waiting',
      a.n || case when a.n = 1 then ' new match is' else ' new matches are' end || ' waiting for you',
      'You''re out of match credits. Top up to see them: ₹250 buys 1,000 matches.',
      '/billing', false
    from public.account_members am
    where am.account_id = a.account_id and am.status = 'active' and am.user_id is not null;
    insert into public.waiting_alert_state (account_id, last_alert_at) values (a.account_id, now())
    on conflict (account_id) do update set last_alert_at = now();
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.notify_waiting_matches() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_pipeline_matcher()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_added integer;
begin
  v_added := public.refresh_pipeline_cards(interval '36 hours', now() - interval '15 minutes', interval '7 days');
  -- Alerts are best-effort: a failure here must not roll back the new cards.
  begin
    perform public.notify_new_tracker_matches();
  exception when others then
    raise warning 'notify_new_tracker_matches failed: %', sqlerrm;
  end;
  begin
    perform public.notify_waiting_matches();
  exception when others then
    raise warning 'notify_waiting_matches failed: %', sqlerrm;
  end;
  return v_added;
end;
$function$;

-- 1. Ops alerts.
create table if not exists public.ops_alert_state (
  key text primary key,
  last_sent_at timestamptz not null
);
alter table public.ops_alert_state enable row level security;

create or replace function public.check_scheduled_jobs()
returns integer language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  r record;
  v_lines text[] := '{}';
  v_token text;
begin
  for r in
    select j.jobname, count(*) as n, max(d.return_message) as msg
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '15 minutes' and d.status = 'failed'
    group by j.jobname
  loop
    v_lines := v_lines || format('%s failed %s time(s) in the last 15 minutes: %s', r.jobname, r.n, left(coalesce(r.msg, ''), 200));
  end loop;
  if not exists (
    select 1 from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where j.jobname = 'pipeline-matcher' and d.status = 'succeeded' and d.start_time > now() - interval '25 minutes'
  ) then
    v_lines := v_lines || 'pipeline-matcher has not succeeded in the last 25 minutes, so no new matches are being created.'::text;
  end if;
  for r in
    select d.end_time - d.start_time as dur
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where j.jobname = 'pipeline-matcher' and d.status = 'succeeded' and d.start_time > now() - interval '15 minutes'
      and d.end_time - d.start_time > interval '60 seconds'
  loop
    v_lines := v_lines || format('pipeline-matcher took %s (the limit is 2 minutes).', r.dur);
  end loop;

  if cardinality(v_lines) = 0 then return 0; end if;
  if exists (select 1 from public.ops_alert_state where key = 'scheduled_jobs' and last_sent_at > now() - interval '60 minutes') then
    return 0;
  end if;
  select value into v_token from public.signup_notify_config where key = 'webhook_token';
  perform net.http_post(
    url := 'https://nhwqcqzvotgdngtxulwi.supabase.co/functions/v1/ops-alert',
    body := jsonb_build_object('token', v_token, 'subject', 'ProfilePush: a scheduled job needs attention', 'lines', to_jsonb(v_lines)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od3FjcXp2b3RnZG5ndHh1bHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjY3NDQsImV4cCI6MjA5NjQ0Mjc0NH0.DCPM9hZwqEsfmStT1beaUtp3P-uDVkCZL8xv0ZFpCss', 'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od3FjcXp2b3RnZG5ndHh1bHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjY3NDQsImV4cCI6MjA5NjQ0Mjc0NH0.DCPM9hZwqEsfmStT1beaUtp3P-uDVkCZL8xv0ZFpCss'),
    timeout_milliseconds := 10000
  );
  insert into public.ops_alert_state (key, last_sent_at) values ('scheduled_jobs', now())
  on conflict (key) do update set last_sent_at = now();
  return 1;
end;
$$;
revoke all on function public.check_scheduled_jobs() from public, anon, authenticated;

select cron.unschedule('ops-check-scheduled-jobs') where exists (select 1 from cron.job where jobname = 'ops-check-scheduled-jobs');
select cron.schedule('ops-check-scheduled-jobs', '8-59/10 * * * *', 'select public.check_scheduled_jobs();');
