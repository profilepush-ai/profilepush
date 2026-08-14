-- RPCs for the market-stats outreach worker.
-- security definer is required to read auth.users, which PostgREST does not
-- expose directly (same pattern as get_daily_digest_recipients).

create or replace function public.email_has_account(check_email text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(trim(check_email))
  );
$$;

revoke all on function public.email_has_account(text) from public;
grant execute on function public.email_has_account(text) to service_role;

-- Atomically claims the daily outreach-send slot for an email address.
-- Returns claimed = true only if the caller may proceed to send; false if
-- already sent today, or unsubscribed. Safe under concurrent callers: the
-- INSERT ... ON CONFLICT ... DO UPDATE is a single atomic statement, so a
-- second concurrent call for the same email blocks on the first's row lock
-- until it commits, then re-evaluates the WHERE clause against the
-- now-committed row — at most one caller ever gets claimed = true.
create or replace function public.claim_market_stats_email_send(p_email text)
returns table(claimed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_claimed boolean;
begin
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
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

-- Next batch of never-before-processed poster emails for the backfill cron.
-- The anti-join against market_stats_email_sends is itself the cursor: once
-- a candidate is claimed (sent or not) it gets a row there and never
-- reappears in a later batch. Emails that already have a platform account
-- are excluded live on every call and never need a market_stats_email_sends
-- row at all.
create or replace function public.get_market_stats_outreach_backfill_batch(p_limit integer default 25)
returns table(email text, source text)
language sql
security definer
set search_path = public, auth
as $$
  with candidates as (
    select distinct lower(trim(sj.poster_email)) as email, 'job' as source
    from public.social_jobs sj
    where sj.poster_email is not null and trim(sj.poster_email) <> ''
    union
    select distinct lower(trim(sh.bench_sales_recruiter_email)) as email, 'hotlist' as source
    from public.social_hotlist sh
    where sh.bench_sales_recruiter_email is not null and trim(sh.bench_sales_recruiter_email) <> ''
  ),
  deduped as (
    select email, min(source) as source
    from candidates
    group by email
  )
  select d.email, d.source
  from deduped d
  where not exists (select 1 from public.market_stats_email_sends s where s.email = d.email)
    and not exists (select 1 from auth.users u where lower(u.email) = d.email)
  order by d.email asc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
$$;

revoke all on function public.get_market_stats_outreach_backfill_batch(integer) from public;
grant execute on function public.get_market_stats_outreach_backfill_batch(integer) to service_role;
