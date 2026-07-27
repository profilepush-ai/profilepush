create or replace function public.get_public_recruiter_count()
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.account_members
  where status = 'active'
    and user_id is not null;
$$;

revoke all on function public.get_public_recruiter_count() from public;
grant execute on function public.get_public_recruiter_count() to anon;
grant execute on function public.get_public_recruiter_count() to authenticated;
