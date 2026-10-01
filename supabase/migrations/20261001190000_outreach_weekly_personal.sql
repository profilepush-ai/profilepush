-- Outreach to posters who aren't users (market-stats-outreach), restarted
-- with personal emails that link to their public profile and a one-tap claim.
--
-- claim_market_stats_email_send now allows at most one email a week per
-- person (was one a day), and refuses claimed, removed or opted-out profiles,
-- addresses that hard-bounced or complained, and anyone who got 3 emails
-- without clicking. The daily ceiling goes from 150 to 300; raise it in
-- market_stats_outreach_config (steady_state_cap) as results allow, with no
-- deploy.

create or replace function public.claim_market_stats_email_send(p_email text)
returns table(claimed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_claimed boolean;
  v_warmup_start date;
  v_initial_cap numeric;
  v_growth numeric;
  v_duration integer;
  v_steady_cap integer;
  v_day_index integer;
  v_cap integer;
  v_sent_today integer;
begin
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query select false;
    return;
  end if;

  -- Never to a profile that was claimed, removed or opted out, nor to an
  -- address that hard-bounced or complained, nor after 3 emails nobody
  -- clicked.
  if exists (
    select 1 from public.publisher_profiles p
    where p.email = public.publisher_email_key(v_email)
      and (p.claimed_account_id is not null or p.removed_at is not null or p.email_opted_out)
  ) or exists (
    select 1 from public.email_sends s
    where lower(s.to_email) = v_email and (s.complained_at is not null or s.bounce_type like 'Permanent%')
  ) or exists (
    select 1 from public.market_stats_email_sends m
    where m.email = v_email and m.send_count >= 3
      and not exists (
        select 1 from public.email_sends s
        where lower(s.to_email) = v_email and s.category = 'outreach_pitch' and s.clicked_at is not null
      )
  ) then
    return query select false;
    return;
  end if;

  -- Serializes concurrent callers against the daily-cap check below, so two
  -- simultaneous claims (e.g. the backfill cron and a real-time webhook
  -- firing at the same moment) can never both slip through once the cap is
  -- hit. Released automatically at transaction end — no cleanup needed.
  perform pg_advisory_xact_lock(hashtext('market_stats_email_sends_daily_cap'));

  select nullif(value, '')::date into v_warmup_start
  from public.market_stats_outreach_config where key = 'warmup_start_date';
  select coalesce(nullif(value, '')::numeric, 5) into v_initial_cap
  from public.market_stats_outreach_config where key = 'warmup_initial_cap';
  select coalesce(nullif(value, '')::numeric, 1.15) into v_growth
  from public.market_stats_outreach_config where key = 'warmup_daily_growth';
  select coalesce(nullif(value, '')::integer, 30) into v_duration
  from public.market_stats_outreach_config where key = 'warmup_duration_days';
  select coalesce(nullif(value, '')::integer, 150) into v_steady_cap
  from public.market_stats_outreach_config where key = 'steady_state_cap';

  if v_warmup_start is null then
    -- No warmup start configured: fall back to the steady-state ceiling
    -- rather than sending unbounded.
    v_cap := v_steady_cap;
  else
    v_day_index := ((now() at time zone 'utc')::date - v_warmup_start);
    if v_day_index < 0 then
      v_cap := least(v_steady_cap, floor(v_initial_cap)::integer);
    elsif v_day_index >= v_duration then
      v_cap := v_steady_cap;
    else
      v_cap := least(v_steady_cap, floor(v_initial_cap * power(v_growth, v_day_index))::integer);
    end if;
  end if;

  select count(*) into v_sent_today
  from public.market_stats_email_sends
  where last_sent_date = (now() at time zone 'utc')::date;

  -- Cap hit: refuse the claim without writing a row for this email, so it
  -- stays a valid backfill/webhook candidate on a future day rather than
  -- being silently burned for good (same "acceptable for best-effort
  -- marketing mail" philosophy the send-failure path below already uses).
  -- The caller sees claimed = false either way — same as "already sent
  -- today" — so its logged reason is imprecise when the real cause is the
  -- cap; a minor observability gap, not a functional one.
  if v_sent_today >= v_cap then
    return query select false;
    return;
  end if;

  insert into public.market_stats_email_sends (email, last_sent_date, last_sent_at, send_count, updated_at)
  values (v_email, (now() at time zone 'utc')::date, now(), 1, now())
  on conflict (email) do update
    set last_sent_date = (now() at time zone 'utc')::date,
        last_sent_at   = now(),
        send_count     = market_stats_email_sends.send_count + 1,
        updated_at     = now()
    where market_stats_email_sends.unsubscribed = false
      -- At most one email a week per person.
      and (market_stats_email_sends.last_sent_at is null or market_stats_email_sends.last_sent_at < now() - interval '7 days')
  returning true into v_claimed;

  return query select coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_market_stats_email_send(text) from public;
grant execute on function public.claim_market_stats_email_send(text) to service_role;

insert into public.market_stats_outreach_config (key, value)
values ('steady_state_cap', '300')
on conflict (key) do update set value = excluded.value;
