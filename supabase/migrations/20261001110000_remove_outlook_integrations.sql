-- Send via Outlook was dropped (2026-10-01): ProfilePush users send from
-- company mailboxes whose Microsoft admins would have to approve the app, so
-- it is not worth it. This removes what 20261001100000 added and restores the
-- send quota's Gmail-only "connected". No Outlook connection was ever made.
create or replace function public.get_ai_submit_quota()
returns table (
  used_today integer,
  daily_limit integer,
  remaining integer,
  is_trial boolean,
  gmail_connected boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_is_trial boolean;
  v_used integer;
  v_limit integer;
  v_gmail boolean;
begin
  select am.account_id into v_account_id
  from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active'
  order by am.created_at asc
  limit 1;

  if v_account_id is null then
    return query select 0, 0, 0, true, false;
    return;
  end if;

  select coalesce(a.is_trial, true) into v_is_trial
  from public.accounts a where a.id = v_account_id;

  v_limit := case when v_is_trial then 10 else 100 end;

  -- UTC day, matching every other daily figure in the platform. A local-day
  -- window would let someone reset their quota by changing timezone.
  select count(*)::integer into v_used
  from public.pulse_ask_ai_requests r
  where r.account_id = v_account_id
    and r.created_at >= date_trunc('day', now() at time zone 'utc');

  select exists (
    select 1 from public.gmail_integrations g
    where g.account_id = v_account_id and g.status = 'connected'
  ) into v_gmail;

  return query select v_used, v_limit, greatest(0, v_limit - v_used), v_is_trial, v_gmail;
end;
$$;

revoke all on function public.get_ai_submit_quota() from public, anon;
grant execute on function public.get_ai_submit_quota() to authenticated;

drop view if exists public.outlook_integration_status;
drop table if exists public.outlook_integrations;

alter table public.vendor_conversations drop constraint if exists vendor_conversations_channel_check;
alter table public.vendor_conversations add constraint vendor_conversations_channel_check
  check (channel in ('mailgun', 'gmail'));
alter table public.vendor_messages drop constraint if exists vendor_messages_channel_check;
alter table public.vendor_messages add constraint vendor_messages_channel_check
  check (channel in ('mailgun', 'gmail'));
