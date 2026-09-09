-- email_has_account only ever checked auth.users, missing account_members
-- rows for someone who has been invited to a real account but hasn't
-- completed signup yet (public.account_members.invited_email, see
-- 20260608185911_create_accounts_and_team_members.sql). Widening this closes
-- a real gap: without it, someone already mid-onboarding to a real
-- ProfilePush account could still get cold-pitched by market-stats-outreach.
create or replace function public.email_has_account(check_email text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(trim(check_email))
  ) or exists (
    select 1 from public.account_members m
    where lower(m.invited_email) = lower(trim(check_email))
  );
$$;

revoke all on function public.email_has_account(text) from public;
grant execute on function public.email_has_account(text) to service_role;
