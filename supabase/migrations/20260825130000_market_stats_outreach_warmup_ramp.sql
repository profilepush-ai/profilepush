-- The flat daily_send_cap (60, added minutes ago in
-- 20260825120000_add_market_stats_outreach_daily_cap.sql) was already an
-- improvement over zero limiting, but a live incident just proved it wasn't
-- conservative enough: the GMass mailbox this worker shares with the
-- registered-user digest (profilepush-email-notifications, GMASS_FROM_EMAIL
-- = Insights@profilepush.ai) only started warming up on 2026-08-23 — the
-- digest stream already respects that, capping itself to
-- floor(10 * 1.2^days_since_warmup_start) recipients (14 on day 2, today).
-- market-stats-outreach sent 138 emails today alone through the SAME
-- 2-day-old mailbox, on top of whatever the digest sent — Google bounced
-- outbound mail with "you have reached a limit for sending mail" as a
-- result. A flat cap picked without regard to mailbox age can't prevent
-- this; only a ramp tied to the same warmup clock can.
--
-- Replaces the flat cap with a ramp using the identical growth formula as
-- profilepush-email-notifications/src/index.ts (WARMUP_INITIAL_CAP /
-- WARMUP_DAILY_GROWTH / WARMUP_DURATION_DAYS), but a lower initial cap and
-- slower growth than the digest's own ramp — this is a *second* stream
-- sharing the same mailbox budget, not sized 1:1 with the primary one — plus
-- a permanent steady-state ceiling once warmup completes. Unlike the digest
-- (which only ever addresses ~99 known accounts and self-limits), this
-- stream's addressable universe (scraped posters) keeps growing, so an
-- unbounded post-warmup cap could still spike arbitrarily high.
insert into public.market_stats_outreach_config (key, value)
values ('warmup_start_date', '2026-08-23')
on conflict (key) do update set value = excluded.value, updated_at = now();

insert into public.market_stats_outreach_config (key, value)
values ('warmup_initial_cap', '5')
on conflict (key) do nothing;

insert into public.market_stats_outreach_config (key, value)
values ('warmup_daily_growth', '1.15')
on conflict (key) do nothing;

insert into public.market_stats_outreach_config (key, value)
values ('warmup_duration_days', '30')
on conflict (key) do nothing;

insert into public.market_stats_outreach_config (key, value)
values ('steady_state_cap', '150')
on conflict (key) do nothing;

-- Superseded by the warmup ramp below; left in place (unused) rather than
-- deleted so a rollback to the previous migration doesn't need to recreate it.
update public.market_stats_outreach_config set value = '0', updated_at = now() where key = 'daily_send_cap';

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
      and market_stats_email_sends.last_sent_date is distinct from (now() at time zone 'utc')::date
  returning true into v_claimed;

  return query select coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_market_stats_email_send(text) from public;
grant execute on function public.claim_market_stats_email_send(text) to service_role;
