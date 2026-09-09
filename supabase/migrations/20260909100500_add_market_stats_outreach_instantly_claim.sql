-- market-stats-outreach is moving its send path from a shared GMass mailbox
-- to Instantly.ai, which manages its own mailbox pool/warmup/rotation. The
-- existing claim_market_stats_email_send's cap formula is a warmup ramp tied
-- to that specific GMass mailbox's age (see
-- 20260825130000_market_stats_outreach_warmup_ramp.sql) — meaningless once
-- Instantly owns delivery. Rather than mutate that function in place, add a
-- sibling that reuses the SAME market_stats_email_sends table (the single
-- source of truth preventing double-emailing a scraped poster across
-- campaigns) but with a flat cap sized to this stream's own observed volume
-- (~600/day combined) instead of a mailbox-warmup formula. The old function
-- is left in place unused, same precedent this migration file's predecessor
-- already set for the pre-warmup flat cap ("superseded, left in place rather
-- than deleted, for rollback").
insert into public.market_stats_outreach_config (key, value)
values ('instantly_daily_send_cap', '800')
on conflict (key) do nothing;

alter table public.market_stats_email_sends add column if not exists last_sent_via text;
comment on column public.market_stats_email_sends.last_sent_via is
  'Which send path claimed this slot (''instantly'' or null/legacy GMass) — debugging only, not read by any RPC.';

create or replace function public.claim_market_stats_email_send_instantly(p_email text)
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

  -- Distinct advisory-lock key from claim_market_stats_email_send's, so the
  -- two functions can never contend even if both ever ran concurrently
  -- during cutover.
  perform pg_advisory_xact_lock(hashtext('market_stats_email_sends_instantly_daily_cap'));

  select coalesce(nullif(value, '')::integer, 800) into v_cap
  from public.market_stats_outreach_config
  where key = 'instantly_daily_send_cap';
  v_cap := coalesce(v_cap, 800);

  select count(*) into v_sent_today
  from public.market_stats_email_sends
  where last_sent_date = (now() at time zone 'utc')::date;

  if v_sent_today >= v_cap then
    return query select false;
    return;
  end if;

  insert into public.market_stats_email_sends (email, last_sent_date, last_sent_at, send_count, last_sent_via, updated_at)
  values (v_email, (now() at time zone 'utc')::date, now(), 1, 'instantly', now())
  on conflict (email) do update
    set last_sent_date = (now() at time zone 'utc')::date,
        last_sent_at   = now(),
        send_count     = market_stats_email_sends.send_count + 1,
        last_sent_via  = 'instantly',
        updated_at     = now()
    where market_stats_email_sends.unsubscribed = false
      and market_stats_email_sends.last_sent_date is distinct from (now() at time zone 'utc')::date
  returning true into v_claimed;

  return query select coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_market_stats_email_send_instantly(text) from public;
grant execute on function public.claim_market_stats_email_send_instantly(text) to service_role;
