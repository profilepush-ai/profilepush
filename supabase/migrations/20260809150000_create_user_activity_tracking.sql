create table if not exists public.user_activity_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id text not null,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  unique (user_id, auth_session_id)
);

create index if not exists user_activity_sessions_account_started_idx
  on public.user_activity_sessions (account_id, started_at desc);

create table if not exists public.user_activity_daily (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  session_count integer not null default 0 check (session_count >= 0),
  active_seconds integer not null default 0 check (active_seconds >= 0),
  last_activity_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

create index if not exists user_activity_daily_account_date_idx
  on public.user_activity_daily (account_id, activity_date desc);

alter table public.user_activity_sessions enable row level security;
alter table public.user_activity_daily enable row level security;

create policy "users_read_own_activity_sessions"
  on public.user_activity_sessions for select to authenticated
  using (user_id = auth.uid());

create policy "users_read_own_daily_activity"
  on public.user_activity_daily for select to authenticated
  using (user_id = auth.uid());

create or replace function public.track_user_activity(p_auth_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid;
  v_now timestamptz := clock_timestamp();
  v_previous_heartbeat timestamptz;
  v_is_new_session boolean := false;
  v_elapsed_seconds integer := 0;
begin
  if v_user_id is null or nullif(trim(p_auth_session_id), '') is null then
    return;
  end if;

  select account_id
  into v_account_id
  from public.account_members
  where user_id = v_user_id and status = 'active'
  limit 1;

  if v_account_id is null then
    return;
  end if;

  insert into public.user_activity_sessions (
    account_id,
    user_id,
    auth_session_id,
    started_at,
    last_heartbeat_at
  ) values (
    v_account_id,
    v_user_id,
    p_auth_session_id,
    v_now,
    v_now
  )
  on conflict (user_id, auth_session_id) do nothing;

  v_is_new_session := found;

  select last_heartbeat_at
  into v_previous_heartbeat
  from public.user_activity_sessions
  where user_id = v_user_id and auth_session_id = p_auth_session_id
  for update;

  if v_previous_heartbeat is not null then
    v_elapsed_seconds := least(
      60,
      greatest(0, floor(extract(epoch from (v_now - v_previous_heartbeat)))::integer)
    );
  end if;

  update public.user_activity_sessions
  set last_heartbeat_at = v_now
  where user_id = v_user_id and auth_session_id = p_auth_session_id;

  insert into public.user_activity_daily (
    account_id,
    user_id,
    activity_date,
    session_count,
    active_seconds,
    last_activity_at
  ) values (
    v_account_id,
    v_user_id,
    v_now::date,
    case when v_is_new_session then 1 else 0 end,
    v_elapsed_seconds,
    v_now
  )
  on conflict (user_id, activity_date) do update
  set account_id = excluded.account_id,
      session_count = public.user_activity_daily.session_count + excluded.session_count,
      active_seconds = public.user_activity_daily.active_seconds + excluded.active_seconds,
      last_activity_at = greatest(public.user_activity_daily.last_activity_at, excluded.last_activity_at);
end;
$$;

revoke all on function public.track_user_activity(text) from public;
grant execute on function public.track_user_activity(text) to authenticated;