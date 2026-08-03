create table if not exists public.hotlist_match_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null default 'unknown',
  trigger_payload jsonb,
  account_id uuid references public.accounts(id) on delete set null,
  role_id uuid references public.hotlist_ai_roles(id) on delete set null,
  roles_found integer not null default 0,
  profiles_processed integer not null default 0,
  total_matched integer not null default 0,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_hotlist_match_runs_created_at on public.hotlist_match_runs(created_at desc);
create index if not exists idx_hotlist_match_runs_status on public.hotlist_match_runs(status);
create index if not exists idx_hotlist_match_runs_trigger_source on public.hotlist_match_runs(trigger_source);

alter table public.hotlist_match_runs enable row level security;

drop policy if exists select_all_hotlist_match_runs on public.hotlist_match_runs;
drop policy if exists insert_all_hotlist_match_runs on public.hotlist_match_runs;
drop policy if exists update_all_hotlist_match_runs on public.hotlist_match_runs;

create policy select_all_hotlist_match_runs
  on public.hotlist_match_runs
  for select
  using (true);

create policy insert_all_hotlist_match_runs
  on public.hotlist_match_runs
  for insert
  with check (true);

create policy update_all_hotlist_match_runs
  on public.hotlist_match_runs
  for update
  using (true)
  with check (true);
