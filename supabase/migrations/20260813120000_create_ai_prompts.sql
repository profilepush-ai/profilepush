create table if not exists public.ai_prompts (
  prompt_key text primary key,
  system_prompt text,
  user_prompt text,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.ai_prompts enable row level security;
revoke all on table public.ai_prompts from anon, authenticated;
grant select, insert, update, delete on table public.ai_prompts to service_role;
