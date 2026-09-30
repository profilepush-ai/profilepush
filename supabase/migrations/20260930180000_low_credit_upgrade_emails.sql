-- Daily "you're running low on credits" email, pointing at the 500-credit pack.
--
-- Low means under half of what the account last had to spend: half the 100
-- free credits (50) on a free account, half of the last credit pack bought on
-- a paid one. Sent to the account owner once a UTC day at most, only while the
-- account has been active in the last 30 days, and never after they
-- unsubscribe (notification_preferences notif_type 'low_credits').
create table if not exists public.low_credit_email_log (
  account_id uuid not null references public.accounts(id) on delete cascade,
  sent_on date not null,
  balance numeric,
  primary key (account_id, sent_on)
);

alter table public.low_credit_email_log enable row level security;
revoke all on public.low_credit_email_log from anon, authenticated;
grant select, insert, update, delete on public.low_credit_email_log to service_role;

create or replace function public.get_low_credit_upgrade_recipients()
returns table (account_id uuid, user_id uuid, email text, name text, balance numeric, threshold numeric)
language sql
stable
security definer
set search_path = public, auth
as $$
  with plan as (
    select a.id, a.owner_id, a.credits_balance, coalesce(a.is_trial, true) as is_trial,
      (select o.credits from public.credit_topup_orders o
        where o.account_id = a.id and o.status = 'paid'
        order by coalesce(o.paid_at, o.created_at) desc limit 1) as last_pack
    from public.accounts a
  )
  select p.id, u.id, lower(trim(u.email)),
    coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), ''), ''),
    p.credits_balance,
    case when p.is_trial or p.last_pack is null then 50 else p.last_pack / 2.0 end
  from plan p
  join auth.users u on u.id = p.owner_id
  where u.email_confirmed_at is not null
    and coalesce(u.email, '') <> ''
    and p.credits_balance < case when p.is_trial or p.last_pack is null then 50 else p.last_pack / 2.0 end
    and exists (
      select 1 from public.user_activity_daily d
      where d.account_id = p.id and d.activity_date >= current_date - 30
    )
    and not exists (
      select 1 from public.notification_preferences np
      where np.user_id = u.id and np.notif_type = 'low_credits' and np.email_enabled = false
    )
    and not exists (
      select 1 from public.low_credit_email_log l
      where l.account_id = p.id and l.sent_on = (now() at time zone 'utc')::date
    )
$$;

create or replace function public.mark_low_credit_emails_sent(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.low_credit_email_log (account_id, sent_on, balance)
  select (r->>'account_id')::uuid, (now() at time zone 'utc')::date, (r->>'balance')::numeric
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  on conflict (account_id, sent_on) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.get_low_credit_upgrade_recipients() from public, anon, authenticated;
revoke all on function public.mark_low_credit_emails_sent(jsonb) from public, anon, authenticated;
grant execute on function public.get_low_credit_upgrade_recipients() to service_role;
grant execute on function public.mark_low_credit_emails_sent(jsonb) to service_role;
