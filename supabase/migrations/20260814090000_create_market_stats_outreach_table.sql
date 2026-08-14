-- Dedup/suppression table for the market-stats outreach worker: tracks the
-- last time we emailed a scraped (non-platform) poster email, so the same
-- address never gets more than one outreach email per UTC calendar day, and
-- so unsubscribes are permanent.
create table if not exists public.market_stats_email_sends (
  email text primary key,              -- lowercased, trimmed
  last_sent_date date,                 -- UTC calendar date of last successful claim
  last_sent_at timestamptz,
  send_count integer not null default 0,
  unsubscribed boolean not null default false,
  unsubscribed_at timestamptz,
  last_source text,                    -- 'job' | 'hotlist', debugging only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.market_stats_email_sends enable row level security;

-- Deliberately no grants to authenticated/anon and no policies: this table
-- holds scraped personal emails and must never be exposed via PostgREST to
-- any client role. Only service_role (via the RPCs below, or the outreach
-- worker's unsubscribe endpoint) should ever touch it.
grant select, insert, update on public.market_stats_email_sends to service_role;
