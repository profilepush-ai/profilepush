create table if not exists public.hotlist_ai_roles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  target_role text not null,
  years_exp integer,
  visa_status text,
  employment_type text,
  work_type text,
  preferred_locations text,
  min_rate_usd_per_hr numeric(10,2),
  max_rate_usd_per_hr numeric(10,2),
  relocation_open boolean default false,
  priority_skills text,
  schedule_frequency text not null default 'daily' check (schedule_frequency in ('disabled', 'hourly', 'daily', 'twice_daily', 'weekly')),
  is_active boolean not null default true,
  last_run_at timestamptz,
  last_result_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hotlist_ai_matches (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.hotlist_ai_roles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  profile_id uuid not null,
  score integer not null default 0,
  ai_notes text,
  score_breakdown jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_hotlist_ai_roles_account on public.hotlist_ai_roles(account_id);
create index if not exists idx_hotlist_ai_roles_active on public.hotlist_ai_roles(is_active);
create index if not exists idx_hotlist_ai_matches_role on public.hotlist_ai_matches(role_id);
create index if not exists idx_hotlist_ai_matches_account on public.hotlist_ai_matches(account_id);

alter table public.hotlist_ai_roles enable row level security;
alter table public.hotlist_ai_matches enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'hotlist_ai_roles' and policyname = 'select_own_hotlist_ai_roles'
  ) then
    create policy select_own_hotlist_ai_roles on public.hotlist_ai_roles
    for select using (
      account_id in (
        select account_id from public.account_members where user_id = auth.uid() and status = 'active'
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'hotlist_ai_roles' and policyname = 'insert_own_hotlist_ai_roles'
  ) then
    create policy insert_own_hotlist_ai_roles on public.hotlist_ai_roles
    for insert with check (
      account_id in (
        select account_id from public.account_members where user_id = auth.uid() and status = 'active'
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'hotlist_ai_roles' and policyname = 'update_own_hotlist_ai_roles'
  ) then
    create policy update_own_hotlist_ai_roles on public.hotlist_ai_roles
    for update using (
      account_id in (
        select account_id from public.account_members where user_id = auth.uid() and status = 'active'
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'hotlist_ai_roles' and policyname = 'delete_own_hotlist_ai_roles'
  ) then
    create policy delete_own_hotlist_ai_roles on public.hotlist_ai_roles
    for delete using (
      account_id in (
        select account_id from public.account_members where user_id = auth.uid() and status = 'active'
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'hotlist_ai_matches' and policyname = 'select_own_hotlist_ai_matches'
  ) then
    create policy select_own_hotlist_ai_matches on public.hotlist_ai_matches
    for select using (
      account_id in (
        select account_id from public.account_members where user_id = auth.uid() and status = 'active'
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'hotlist_ai_matches' and policyname = 'insert_own_hotlist_ai_matches'
  ) then
    create policy insert_own_hotlist_ai_matches on public.hotlist_ai_matches
    for insert with check (
      account_id in (
        select account_id from public.account_members where user_id = auth.uid() and status = 'active'
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'hotlist_ai_matches' and policyname = 'delete_own_hotlist_ai_matches'
  ) then
    create policy delete_own_hotlist_ai_matches on public.hotlist_ai_matches
    for delete using (
      account_id in (
        select account_id from public.account_members where user_id = auth.uid() and status = 'active'
      )
    );
  end if;
end $$;
