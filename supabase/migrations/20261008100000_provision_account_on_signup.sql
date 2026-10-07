/*
# Provision the account in the database, the moment a login is created

## Problem
Accounts were created only by the browser, after sign-up (ensureAccountForUser
in src/lib/account-provisioning.ts). If that step never ran or failed — a
closed tab, a dropped connection, a refused insert — the person was left with
a login and no account, and the failure was silent. 13 people were in that
state (the latest on 2026-10-07 16:58 UTC).

## What this migration does
1. public.provision_account_for_user(uuid): creates the account and the owner
   membership for a user who has no active membership. Idempotent.
2. A trigger on auth.users runs it for every new login. It can never block a
   sign-up: any error is caught and the insert into auth.users proceeds (the
   browser's own provisioning still runs afterwards as a backup).
3. Repairs every existing login that has no active membership.
*/

create or replace function public.provision_account_for_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user auth.users%rowtype;
  v_account_id uuid;
  v_name text;
begin
  select * into v_user from auth.users where id = p_user_id;
  if not found then
    return;
  end if;

  if exists (
    select 1 from public.account_members am
    where am.user_id = p_user_id and am.status = 'active'
  ) then
    return;
  end if;

  v_name := coalesce(
    nullif(trim(v_user.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(v_user.raw_user_meta_data->>'name'), ''),
    nullif(split_part(coalesce(v_user.email, ''), '@', 1), ''),
    'My Workspace'
  );

  v_account_id := gen_random_uuid();

  insert into public.accounts (id, name, owner_id, created_at)
  values (v_account_id, v_name, p_user_id, now());

  insert into public.account_members (account_id, user_id, invited_email, role, status, created_at)
  values (v_account_id, p_user_id, coalesce(v_user.email, ''), 'owner', 'active', now());
end;
$$;

revoke all on function public.provision_account_for_user(uuid) from public, anon, authenticated;
grant execute on function public.provision_account_for_user(uuid) to service_role;

create or replace function public.provision_account_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.provision_account_for_user(new.id);
  exception when others then
    -- Never block a sign-up. The browser's provisioning still runs after
    -- sign-up and will create the account if this did not.
    raise warning 'provision_account_on_signup failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists provision_account_on_signup on auth.users;
create trigger provision_account_on_signup
  after insert on auth.users
  for each row execute function public.provision_account_on_signup();

-- Repair everyone currently stuck with a login and no account.
do $$
declare
  r record;
begin
  for r in
    select u.id
    from auth.users u
    where not exists (
      select 1 from public.account_members am
      where am.user_id = u.id and am.status = 'active'
    )
  loop
    begin
      perform public.provision_account_for_user(r.id);
    exception when others then
      raise warning 'backfill failed for %: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;
