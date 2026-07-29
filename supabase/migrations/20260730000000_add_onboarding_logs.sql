-- Migration: Add onboarding_logs table to track user onboarding actions

create table if not exists onboarding_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  action text not null check (action in ('watched', 'remind_later', 'skipped', 'viewed')),
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create index idx_onboarding_logs_user_id on onboarding_logs(user_id);
create index idx_onboarding_logs_account_id on onboarding_logs(account_id);
create index idx_onboarding_logs_action on onboarding_logs(action);

-- RLS
alter table onboarding_logs enable row level security;

create policy "Users can insert their own onboarding logs"
  on onboarding_logs for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can view their own onboarding logs"
  on onboarding_logs for select
  to authenticated
  using (auth.uid() = user_id);
