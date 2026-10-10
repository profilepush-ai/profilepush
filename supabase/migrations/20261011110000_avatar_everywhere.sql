/*
# Your avatar everywhere

A user's photo across ProfilePush is their avatar while it's on (their
account has credits or an active plan), otherwise their Google photo:
- their posts (jobs and profiles posted in the app), which other people
  see on cards, in the feed and in Today;
- their network profile (publisher_profiles);
- the app's own header (read in the app through my-avatar).
pp_sync_user_photo() writes it into posts and the network profile when the
avatar is turned on or removed, and whenever the account's credits run out
or come back, or its plan starts or ends. New posts take it as they're made.
*/

create or replace function public.pp_user_photo(p_user uuid)
returns text language sql stable security definer set search_path to 'public', 'auth' as $$
  select coalesce(
    (select v.url from public.user_avatars v
      where v.user_id = p_user and v.status = 'active' and v.url is not null
        and public.pp_avatar_on(public.publisher_account_for_user(p_user))),
    (select coalesce(nullif(u.raw_user_meta_data->>'avatar_url', ''), nullif(u.raw_user_meta_data->>'picture', ''))
      from auth.users u where u.id = p_user))
$$;
revoke all on function public.pp_user_photo(uuid) from public, anon, authenticated;

create or replace function public.pp_sync_user_photo(p_user uuid)
returns integer language plpgsql security definer set search_path to 'public', 'auth' as $$
declare
  v_photo text := public.pp_user_photo(p_user);
  v_email text;
  v_n integer := 0;
  v_m integer;
begin
  update public.social_jobs set avatar_url = v_photo
  where created_by_user_id = p_user and post_source = 'user_post' and avatar_url is distinct from v_photo;
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  update public.social_hotlist set bench_sales_recruiter_avatar_url = v_photo
  where created_by_user_id = p_user and post_source = 'user_post' and bench_sales_recruiter_avatar_url is distinct from v_photo;
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  select u.email into v_email from auth.users u where u.id = p_user;
  if v_email is not null then
    update public.publisher_profiles set avatar_url = coalesce(v_photo, ''), updated_at = now()
    where email = public.publisher_email_key(v_email) and avatar_url is distinct from coalesce(v_photo, '');
  end if;
  return v_n;
end;
$$;
revoke all on function public.pp_sync_user_photo(uuid) from public, anon, authenticated;

-- New posts made in the app show the poster's current photo.
create or replace function public.pp_post_photo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_photo text;
begin
  if new.post_source = 'user_post' and new.created_by_user_id is not null then
    v_photo := public.pp_user_photo(new.created_by_user_id);
    if v_photo is not null then
      if tg_table_name = 'social_jobs' then new.avatar_url := v_photo;
      else new.bench_sales_recruiter_avatar_url := v_photo;
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists pp_post_photo on public.social_jobs;
create trigger pp_post_photo before insert on public.social_jobs for each row execute function public.pp_post_photo();
drop trigger if exists pp_post_photo on public.social_hotlist;
create trigger pp_post_photo before insert on public.social_hotlist for each row execute function public.pp_post_photo();

-- Credits running out or coming back, or a plan starting or ending, switches
-- the avatar off or on for the account's members who have one.
create or replace function public.pp_sync_account_photos(p_account uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.pp_sync_user_photo(am.user_id)
  from public.account_members am
  join public.user_avatars v on v.user_id = am.user_id and v.status = 'active'
  where am.account_id = p_account and am.status = 'active';
end;
$$;
revoke all on function public.pp_sync_account_photos(uuid) from public, anon, authenticated;

create or replace function public.pp_photos_on_credits()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if (coalesce(old.credits_balance, 0) > 0) is distinct from (coalesce(new.credits_balance, 0) > 0) then
    perform public.pp_sync_account_photos(new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists pp_photos_on_credits on public.accounts;
create trigger pp_photos_on_credits after update of credits_balance on public.accounts
  for each row execute function public.pp_photos_on_credits();

create or replace function public.pp_photos_on_plan()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    perform public.pp_sync_account_photos(new.account_id);
  end if;
  return null;
end;
$$;
drop trigger if exists pp_photos_on_plan on public.subscriptions;
create trigger pp_photos_on_plan after insert or update of status on public.subscriptions
  for each row execute function public.pp_photos_on_plan();
