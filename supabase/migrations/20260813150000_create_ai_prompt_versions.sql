create table if not exists public.ai_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null,
  system_prompt text,
  user_prompt text,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists idx_ai_prompt_versions_key on public.ai_prompt_versions (prompt_key, created_at desc);

alter table public.ai_prompt_versions enable row level security;
revoke all on table public.ai_prompt_versions from anon, authenticated;
grant select, insert on table public.ai_prompt_versions to service_role;
