-- Returns active, signed-up users eligible for the daily digest email,
-- excluding anyone who has explicitly opted out via notification_preferences.
-- security definer is required to read auth.users.email, which PostgREST
-- does not expose directly.
create or replace function public.get_daily_digest_recipients()
returns table(user_id uuid, email text, account_id uuid)
language sql
security definer
set search_path = public, auth
as $$
  select distinct on (u.id) u.id as user_id, u.email, am.account_id
  from auth.users u
  join account_members am on am.user_id = u.id
  where am.status = 'active'
    and u.email is not null
    and not exists (
      select 1 from notification_preferences np
      where np.user_id = u.id
        and np.notif_type = 'daily_digest'
        and np.email_enabled = false
    )
  order by u.id, am.created_at asc;
$$;

revoke all on function public.get_daily_digest_recipients() from public;
grant execute on function public.get_daily_digest_recipients() to service_role;
