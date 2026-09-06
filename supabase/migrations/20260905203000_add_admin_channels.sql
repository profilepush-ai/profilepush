-- Admin "Channels" feature: a lightweight per-channel message feed under
-- /admin, starting with a "Marketing" channel that a scheduled screenshot
-- bot posts daily batches into. No public RLS policies — every other admin
-- table in this app (ai_prompts, scraper logs, etc.) is accessed only
-- through a shared-password-gated Supabase Edge Function using the service
-- role, and Channels follows the same pattern.

create table public.admin_channels (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.admin_channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.admin_channels(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'screenshot_batch')),
  body text,
  metadata jsonb not null default '{}'::jsonb,
  author_label text not null default 'Admin',
  created_at timestamptz not null default now()
);

create index admin_channel_messages_channel_created_idx
  on public.admin_channel_messages (channel_id, created_at desc);

alter table public.admin_channels enable row level security;
alter table public.admin_channel_messages enable row level security;

insert into public.admin_channels (slug, name) values ('marketing', 'Marketing');
