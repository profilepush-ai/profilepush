/*
# Avatars for everyone with a Google photo

avatar-backfill makes the 3D avatar for each user with a Google photo who
has none, and turns it on. It shows while their account has credits or a
plan (pp_avatar_on) and falls back to the standard pictures and their Google
photo at 0 credits. consented_at stays empty until they confirm it in the
app; turning it off leaves the row as 'off', so it's never made again for them.

Personal match pictures (their avatar in each job) now go to people who
used the app in the last 7 days, up to 15 new ones a day each; everyone
else sees the job's standard pictures.
*/

alter table public.user_avatars drop constraint if exists user_avatars_status_check;
alter table public.user_avatars add constraint user_avatars_status_check
  check (status in ('making', 'ready', 'active', 'failed', 'off'));

-- Who still needs one: a Google photo, no avatar row at all; the most
-- recently active first.
create or replace function public.avatar_backfill_todo(p_limit integer)
returns table (user_id uuid, photo text) language sql stable security definer set search_path to 'public', 'auth' as $$
  select u.id, p.photo
  from auth.users u
  cross join lateral (
    select coalesce(
      (select coalesce(i.identity_data->>'avatar_url', i.identity_data->>'picture') from auth.identities i
        where i.user_id = u.id and i.provider = 'google' limit 1),
      u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture') as photo) p
  where p.photo ~ 'googleusercontent\.com'
    and not exists (select 1 from public.user_avatars a where a.user_id = u.id)
  order by (select max(d.activity_date) from public.user_activity_daily d where d.user_id = u.id) desc nulls last, u.created_at desc
  limit greatest(1, least(p_limit, 50))
$$;
revoke all on function public.avatar_backfill_todo(integer) from public, anon, authenticated;

create or replace function public.avatar_backfill_left()
returns integer language sql stable security definer set search_path to 'public', 'auth' as $$
  select count(*)::integer from public.avatar_backfill_todo(100000)
$$;
revoke all on function public.avatar_backfill_left() from public, anon, authenticated;

-- Used the app in the last 7 days.
create or replace function public.pp_user_recently_active(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.user_activity_daily d where d.user_id = p_user and d.activity_date > current_date - 7)
$$;
revoke all on function public.pp_user_recently_active(uuid) from public, anon, authenticated;

-- Their avatar into today's matches, when it shows and they use the app.
create or replace function public.queue_my_today_if_active(p_user uuid)
returns integer language sql security definer set search_path to 'public' as $$
  select case when public.pp_user_recently_active(p_user)
      and public.pp_avatar_on(public.publisher_account_for_user(p_user))
    then public.queue_my_today(p_user) else 0 end
$$;
revoke all on function public.queue_my_today_if_active(uuid) from public, anon, authenticated;

-- Every new match queues its post's pictures, and (job posts) a picture for
-- each member whose avatar is on, if they used the app in the last 7 days and
-- have had fewer than 15 such pictures in the last day.
create or replace function public.match_visuals_on_card()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.queue_match_visuals(new.lead_kind, new.lead_id);
  if new.lead_kind = 'job' and public.pp_avatar_on(new.account_id) then
    insert into public.match_visuals_me (lead_id, user_id)
    select new.lead_id, am.user_id
    from public.account_members am
    join public.user_avatars u on u.user_id = am.user_id and u.status = 'active'
    where am.account_id = new.account_id and am.status = 'active'
      and public.pp_user_recently_active(am.user_id)
      and (select count(*) from public.match_visuals_me m where m.user_id = am.user_id and m.created_at > now() - interval '24 hours') < 15
    on conflict (lead_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

-- Every 5 minutes, a few more people.
select cron.unschedule('avatar-backfill') where exists (select 1 from cron.job where jobname = 'avatar-backfill');
select cron.schedule('avatar-backfill', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://nhwqcqzvotgdngtxulwi.supabase.co/functions/v1/avatar-backfill',
    body := '{"limit":6}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od3FjcXp2b3RnZG5ndHh1bHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjY3NDQsImV4cCI6MjA5NjQ0Mjc0NH0.DCPM9hZwqEsfmStT1beaUtp3P-uDVkCZL8xv0ZFpCss'),
    timeout_milliseconds := 150000
  );
$cron$);
