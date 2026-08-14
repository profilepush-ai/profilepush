create table if not exists public.pulse_predict_logs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete set null,
  user_email text not null default '',
  lead_id text not null default '',
  platform text not null default '',
  feed_kind text not null default '',
  role_title text not null default '',
  consultant_text text not null,
  score numeric,
  verdict text not null default '',
  categories jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_pulse_predict_logs_created_at
  on public.pulse_predict_logs (created_at desc);
create index if not exists idx_pulse_predict_logs_account_id
  on public.pulse_predict_logs (account_id);

alter table public.pulse_predict_logs enable row level security;
grant insert, select on public.pulse_predict_logs to service_role;
