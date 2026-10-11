/*
# Avatars reach posts and Network profiles, and stay there

pp_resync_avatar_photos() finds members whose photo should be their avatar
(or should be back to their Google photo) but whose posts or Network profile
still show something else, and syncs them. avatar-backfill runs it every five
minutes, so a sync that didn't land is caught.
*/

create or replace function public.pp_resync_avatar_photos()
returns integer language plpgsql security definer set search_path to 'public', 'auth' as $$
declare
  v_n integer := 0;
  r record;
begin
  for r in
    select a.user_id, public.pp_user_photo(a.user_id) as photo
    from public.user_avatars a
    where a.status in ('active', 'off')
  loop
    if exists (select 1 from public.social_hotlist h where h.created_by_user_id = r.user_id and h.post_source = 'user_post' and h.bench_sales_recruiter_avatar_url is distinct from r.photo)
      or exists (select 1 from public.social_jobs j where j.created_by_user_id = r.user_id and j.post_source = 'user_post' and j.avatar_url is distinct from r.photo)
      or exists (select 1 from public.publisher_profiles p join auth.users u on p.email = public.publisher_email_key(u.email)
                 where u.id = r.user_id and p.avatar_url is distinct from coalesce(r.photo, ''))
    then
      perform public.pp_sync_user_photo(r.user_id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.pp_resync_avatar_photos() from public, anon, authenticated;
