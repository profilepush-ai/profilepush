create table if not exists public.watchlist_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source_hotlist_role_id uuid references public.hotlist_ai_roles(id) on delete set null,
  target_role text not null,
  target_role_key text generated always as (lower(btrim(target_role))) stored,
  category text,
  min_years_exp integer,
  max_years_exp integer,
  visa_status text,
  employment_type text,
  work_type text,
  preferred_locations text,
  min_rate_usd_per_hr numeric(10,2),
  max_rate_usd_per_hr numeric(10,2),
  relocation_open boolean not null default false,
  priority_skills text,
  avatar_url text,
  schedule_frequency text not null default 'hourly' check (schedule_frequency in ('disabled', 'hourly', 'daily', 'twice_daily', 'weekly')),
  is_watching boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  last_unwatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, target_role_key)
);

create index if not exists idx_watchlist_profiles_account_id
  on public.watchlist_profiles(account_id);

create index if not exists idx_watchlist_profiles_is_watching
  on public.watchlist_profiles(is_watching);

create index if not exists idx_watchlist_profiles_source_hotlist_role_id
  on public.watchlist_profiles(source_hotlist_role_id);

alter table public.watchlist_profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'watchlist_profiles' and policyname = 'select_own_watchlist_profiles'
  ) then
    create policy select_own_watchlist_profiles
      on public.watchlist_profiles
      for select
      using (
        account_id in (
          select account_id
          from public.account_members
          where user_id = auth.uid() and status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'watchlist_profiles' and policyname = 'insert_own_watchlist_profiles'
  ) then
    create policy insert_own_watchlist_profiles
      on public.watchlist_profiles
      for insert
      with check (
        account_id in (
          select account_id
          from public.account_members
          where user_id = auth.uid() and status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'watchlist_profiles' and policyname = 'update_own_watchlist_profiles'
  ) then
    create policy update_own_watchlist_profiles
      on public.watchlist_profiles
      for update
      using (
        account_id in (
          select account_id
          from public.account_members
          where user_id = auth.uid() and status = 'active'
        )
      )
      with check (
        account_id in (
          select account_id
          from public.account_members
          where user_id = auth.uid() and status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'watchlist_profiles' and policyname = 'delete_own_watchlist_profiles'
  ) then
    create policy delete_own_watchlist_profiles
      on public.watchlist_profiles
      for delete
      using (
        account_id in (
          select account_id
          from public.account_members
          where user_id = auth.uid() and status = 'active'
        )
      );
  end if;
end $$;