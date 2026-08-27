-- market-stats-outreach targets cold, never-consented scraped poster emails
-- (unlike the registered-user daily digest, which has its own GMass warmup
-- ramp in profilepush-email-notifications/src/index.ts) and has been running
-- completely unthrottled since it launched on 2026-08-13 — real observed
-- volume in market_stats_email_sends has been ~150-200/day with zero
-- ceiling, and nothing stops a burst (e.g. a scraper catching up on a large
-- backlog, which fires the real-time webhook trigger once per new row) from
-- spiking far higher. This is the highest spam-complaint-risk stream this
-- project sends, and it's the one with the least protection.
--
-- Add a configurable daily cap, enforced atomically inside the existing
-- per-email dedup claim (both the real-time webhook and the 30-min backfill
-- cron funnel through this one function, so a single check here covers both
-- paths uniformly). Tunable without a redeploy via
-- market_stats_outreach_config — same table already used for the webhook
-- token.
insert into public.market_stats_outreach_config (key, value)
values ('daily_send_cap', '60')
on conflict (key) do nothing;

create or replace function public.claim_market_stats_email_send(p_email text)
returns table(claimed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_claimed boolean;
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

  select coalesce(nullif(value, '')::integer, 2147483647) into v_cap
  from public.market_stats_outreach_config
  where key = 'daily_send_cap';
  v_cap := coalesce(v_cap, 2147483647);

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
