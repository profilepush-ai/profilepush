-- Subscription limits, revised:
--   free accounts  5 new a day, and at most 10 subscriptions in total
--   paid accounts 10 new a day, no total cap
-- The daily count still comes from publisher_follow_log (unfollowing never
-- refunds a day's allowance); the total is the account's current follows, so
-- unsubscribing from one frees a slot.

drop function if exists public.get_follow_quota();

create function public.get_follow_quota()
returns table (
  used_today integer,
  daily_limit integer,
  remaining integer,
  is_trial boolean,
  following_total integer,
  total_limit integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_trial boolean;
  v_used integer;
  v_limit integer;
  v_total integer;
  v_total_limit integer;
begin
  if v_account is null then
    return query select 0, 0, 0, true, 0, 0;
    return;
  end if;
  select coalesce(a.is_trial, true) into v_trial from public.accounts a where a.id = v_account;
  v_limit := case when v_trial then 5 else 10 end;
  v_total_limit := case when v_trial then 10 else null end;
  select count(*)::integer into v_used
  from public.publisher_follow_log l
  where l.account_id = v_account
    and l.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  select count(*)::integer into v_total from public.publisher_follows f where f.account_id = v_account;
  return query select
    v_used,
    v_limit,
    greatest(0, least(
      v_limit - v_used,
      coalesce(v_total_limit - v_total, v_limit - v_used)
    )),
    v_trial,
    v_total,
    v_total_limit;
end;
$$;

revoke all on function public.get_follow_quota() from public, anon;
grant execute on function public.get_follow_quota() to authenticated;

-- Same as 20260929170000, with the total cap checked before the daily one so
-- a free account at 10 is told about the cap, not about today.
create or replace function public.follow_publisher(p_publisher_id uuid)
returns table (following boolean, used_today integer, daily_limit integer, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  q record;
begin
  if v_account is null then
    raise exception 'No active account membership found';
  end if;
  if not exists (select 1 from public.publisher_profiles where id = p_publisher_id) then
    raise exception 'Publisher not found';
  end if;
  if exists (select 1 from public.publisher_profiles where id = p_publisher_id and claimed_account_id = v_account) then
    raise exception 'You cannot subscribe to your own profile';
  end if;

  if exists (select 1 from public.publisher_follows f where f.account_id = v_account and f.publisher_id = p_publisher_id) then
    select * into q from public.get_follow_quota();
    return query select true, q.used_today, q.daily_limit, q.remaining;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('publisher_follow:' || v_account::text));
  select * into q from public.get_follow_quota();
  if q.total_limit is not null and q.following_total >= q.total_limit then
    raise exception 'FOLLOW_TOTAL_LIMIT_REACHED:%', q.total_limit;
  end if;
  if q.used_today >= q.daily_limit then
    raise exception 'FOLLOW_LIMIT_REACHED:%', q.daily_limit;
  end if;

  insert into public.publisher_follows (account_id, publisher_id, user_id)
  values (v_account, p_publisher_id, auth.uid())
  on conflict (account_id, publisher_id) do nothing;
  insert into public.publisher_follow_log (account_id, publisher_id) values (v_account, p_publisher_id);

  begin
    perform public.notify_publisher_subscribed(p_publisher_id, v_account);
  exception when others then
    null;
  end;

  return query select true, q.used_today + 1, q.daily_limit, greatest(0, q.remaining - 1);
end;
$$;

revoke all on function public.follow_publisher(uuid) from public, anon;
grant execute on function public.follow_publisher(uuid) to authenticated;
