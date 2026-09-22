-- One composer in admin that fans a post out to every connected network.
--
-- Publishing goes through Buffer, whose free plan covers three channels and
-- which already holds approved Facebook and LinkedIn apps — so this needs no
-- Meta app review and no LinkedIn Community Management API approval.
--
-- The row is written before anything is published and updated with what each
-- channel said, so a partial failure is visible and retryable rather than
-- silently half-done. That matters here because each channel is a separate
-- request, and the common failure is one channel's connection expiring in
-- Buffer, which otherwise looks like nothing happened.
--
-- No RLS policies are defined on purpose. Publishing runs through the
-- admin-social-post edge function using the service-role key, which bypasses
-- RLS; with the table protected and no policy granting access, anon and
-- authenticated cannot read or write it at all. Social credentials and post
-- history are not user data.

create table if not exists public.admin_social_posts (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  link_url text,
  image_url text,
  -- Buffer channel ids that were requested. Kept as the requested set rather
  -- than inferred from results, so a channel that failed outright still shows
  -- up as something that was meant to go out.
  channels text[] not null default '{}',
  -- Channel id -> display name at the time of posting. Buffer ids are opaque,
  -- so without this the history becomes unreadable the moment an account is
  -- renamed or disconnected there.
  channel_labels jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'publishing', 'posted', 'partial', 'failed')),
  -- Per channel id: { ok, id, error }. jsonb rather than columns because the
  -- set of channels is whatever is connected in Buffer, not a fixed list.
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

alter table public.admin_social_posts enable row level security;

create index if not exists admin_social_posts_created_at_idx
  on public.admin_social_posts (created_at desc);
