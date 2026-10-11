/*
# The landing page's user count

"Trusted by N job posters and job seekers": people who signed up and
confirmed their email, leaving out our own internal accounts. Public (the
landing page is), and only ever a single number.
*/

create or replace function public.landing_user_count()
returns integer language sql stable security definer set search_path to 'public', 'auth' as $$
  select count(*)::integer from auth.users u
  where u.email_confirmed_at is not null
    and not exists (
      select 1 from public.account_members am join public.accounts a on a.id = am.account_id
      where am.user_id = u.id and coalesce(a.is_internal, false))
$$;
revoke all on function public.landing_user_count() from public;
grant execute on function public.landing_user_count() to anon, authenticated;
