-- Send via Outlook: a user can connect their Microsoft (Outlook / Microsoft 365)
-- mailbox the same way as Gmail, and AI Submit / AI Invite send from it.
-- Send-only, like Gmail: replies stay in the user's own Outlook and are not
-- synced back. Tokens are encrypted with the same key as Gmail's and are only
-- ever read by service-role edge functions.
create table if not exists public.outlook_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  outlook_address text not null,
  scopes text not null default '',
  access_token_encrypted text not null,
  access_token_iv text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_encrypted text not null,
  refresh_token_iv text not null,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error', 'revoked')),
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outlook_integrations enable row level security;
revoke all on public.outlook_integrations from public, anon, authenticated;
grant all on public.outlook_integrations to service_role;

-- Token-free view for the app, scoped to the caller (same pattern as
-- gmail_integration_status).
create or replace view public.outlook_integration_status as
  select id, user_id, account_id, outlook_address, status, last_error, connected_at, updated_at
  from public.outlook_integrations
  where user_id = auth.uid();

grant select on public.outlook_integration_status to authenticated;

-- Conversations and messages record which mailbox they went out through.
alter table public.vendor_conversations drop constraint if exists vendor_conversations_channel_check;
alter table public.vendor_conversations add constraint vendor_conversations_channel_check
  check (channel in ('mailgun', 'gmail', 'outlook'));
alter table public.vendor_messages drop constraint if exists vendor_messages_channel_check;
alter table public.vendor_messages add constraint vendor_messages_channel_check
  check (channel in ('mailgun', 'gmail', 'outlook'));

-- The send quota's "connected" now means either mailbox, so the bulk bar
-- offers sending to Outlook users too. Otherwise as 20260922190000.
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
  v_connected boolean;
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

  select count(*)::integer into v_used
  from public.pulse_ask_ai_requests r
  where r.account_id = v_account_id
    and r.created_at >= date_trunc('day', now() at time zone 'utc');

  select exists (
    select 1 from public.gmail_integrations g
    where g.account_id = v_account_id and g.status = 'connected'
  ) or exists (
    select 1 from public.outlook_integrations o
    where o.account_id = v_account_id and o.status = 'connected'
  ) into v_connected;

  return query select v_used, v_limit, greatest(0, v_limit - v_used), v_is_trial, v_connected;
end;
$$;

revoke all on function public.get_ai_submit_quota() from public, anon;
grant execute on function public.get_ai_submit_quota() to authenticated;
