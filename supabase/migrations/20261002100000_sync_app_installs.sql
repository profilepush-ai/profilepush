-- Records mobile-app users found in OneSignal (sync-app-installs), so the
-- "users without the app" audience and the morning brief's app-user skip
-- know about everyone who installed, not only people who opened the app
-- since tracking started. last_seen_at only ever moves forward.
create or replace function public.record_app_installs_bulk(p_rows jsonb)
returns integer
language sql
security definer
set search_path = public
as $$
  with rows as (
    select (r->>'user_id')::uuid as user_id,
      coalesce(nullif(r->>'platform', ''), 'android') as platform,
      to_timestamp(nullif(r->>'first_active', '')::double precision) as first_active,
      to_timestamp(nullif(r->>'last_active', '')::double precision) as last_active
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where exists (select 1 from auth.users u where u.id = (r->>'user_id')::uuid)
  ),
  up as (
    insert into public.user_app_installs (user_id, platform, first_seen_at, last_seen_at)
    select user_id, platform,
      coalesce(first_active, last_active, now()),
      coalesce(last_active, first_active, now() - interval '30 days')
    from rows
    on conflict (user_id) do update
      set platform = excluded.platform,
          first_seen_at = least(user_app_installs.first_seen_at, excluded.first_seen_at),
          last_seen_at = greatest(user_app_installs.last_seen_at, excluded.last_seen_at)
    returning 1
  )
  select count(*)::integer from up;
$$;

revoke all on function public.record_app_installs_bulk(jsonb) from public, anon, authenticated;
grant execute on function public.record_app_installs_bulk(jsonb) to service_role;
