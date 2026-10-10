/*
# Avatar backfill: the real count of who's left

avatar_backfill_left counted through avatar_backfill_todo, which returns at
most 50; it now counts directly.
*/

create or replace function public.avatar_backfill_left()
returns integer language sql stable security definer set search_path to 'public', 'auth' as $$
  select count(*)::integer
  from auth.users u
  cross join lateral (
    select coalesce(
      (select coalesce(i.identity_data->>'avatar_url', i.identity_data->>'picture') from auth.identities i
        where i.user_id = u.id and i.provider = 'google' limit 1),
      u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture') as photo) p
  where p.photo ~ 'googleusercontent\.com'
    and not exists (select 1 from public.user_avatars a where a.user_id = u.id)
$$;
revoke all on function public.avatar_backfill_left() from public, anon, authenticated;
