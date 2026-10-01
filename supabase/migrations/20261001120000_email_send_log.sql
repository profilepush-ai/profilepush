-- Admin > Emails: one row per email the profilepush-email-notifications
-- worker sends, whatever the lane or provider, so admin can see every email
-- type and how it performs. SES reports delivery, bounces and complaints back
-- to the worker (/ses-events), which fills in the event columns through
-- record_email_event. Service role only: rows hold recipient addresses.

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- digest, low_credits, welcome, signup_alert, screening_invite,
  -- subscriber_notice, outreach_pitch, other
  category text not null,
  -- user (SES) or outreach (GMass)
  lane text not null,
  provider text not null,
  to_email text not null,
  subject text,
  -- sent, rejected (provider refused it for good) or failed (gave up retrying)
  status text not null,
  provider_message_id text,
  error text,
  delivered_at timestamptz,
  bounced_at timestamptz,
  bounce_type text,
  complained_at timestamptz
);

create index if not exists email_sends_created_at_idx on public.email_sends (created_at desc);
create index if not exists email_sends_category_created_at_idx on public.email_sends (category, created_at desc);
create index if not exists email_sends_provider_message_id_idx on public.email_sends (provider_message_id) where provider_message_id is not null;
create index if not exists email_sends_to_email_idx on public.email_sends (lower(to_email));

alter table public.email_sends enable row level security;

-- One row per unsubscribe click (footer link or the mail app's one-click
-- button), by email category.
create table if not exists public.email_unsubscribes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  category text not null,
  user_id uuid,
  email text
);

create index if not exists email_unsubscribes_created_at_idx on public.email_unsubscribes (created_at desc);

alter table public.email_unsubscribes enable row level security;

revoke all on public.email_sends, public.email_unsubscribes from public, anon, authenticated;
grant select, insert, update on public.email_sends, public.email_unsubscribes to service_role;

-- Applies one SES event (Delivery, Bounce, Complaint, Reject) to its send.
-- The first event of each kind wins, so SNS redelivering an event is harmless.
create or replace function public.record_email_event(
  p_message_id text,
  p_event text,
  p_at timestamptz,
  p_detail text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_sends
  set delivered_at = case when p_event = 'Delivery' then coalesce(delivered_at, p_at) else delivered_at end,
      bounced_at = case when p_event = 'Bounce' then coalesce(bounced_at, p_at) else bounced_at end,
      bounce_type = case when p_event = 'Bounce' then coalesce(bounce_type, p_detail) else bounce_type end,
      complained_at = case when p_event = 'Complaint' then coalesce(complained_at, p_at) else complained_at end,
      status = case when p_event = 'Reject' then 'rejected' else status end,
      error = case when p_event = 'Reject' then coalesce(p_detail, error) else error end
  where provider_message_id = p_message_id;
$$;

-- The Emails report: per category totals and outcomes, a daily series, and
-- the AI Submit / AI Invite emails users send from their own Gmail (those go
-- out through Gmail, not this worker, so they come from vendor_messages).
create or replace function public.admin_email_report(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with since as (
    select now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650))) as t
  ),
  sends as (
    select s.* from public.email_sends s, since where s.created_at >= since.t
  ),
  unsubs as (
    select u.category, count(*) as n
    from public.email_unsubscribes u, since
    where u.created_at >= since.t
    group by u.category
  ),
  per_category as (
    select
      s.category,
      min(s.lane) as lane,
      string_agg(distinct s.provider, ', ') as provider,
      count(*) filter (where s.status = 'sent') as sent,
      count(*) filter (where s.status = 'rejected') as rejected,
      count(*) filter (where s.status = 'failed') as failed,
      count(*) filter (where s.delivered_at is not null) as delivered,
      count(*) filter (where s.bounced_at is not null) as bounced,
      count(*) filter (where s.complained_at is not null) as complained,
      count(*) filter (where s.provider = 'ses' and s.status = 'sent') as tracked,
      max(s.created_at) as last_sent
    from sends s
    group by s.category
  ),
  gmail as (
    select count(*) as sent, max(m.created_at) as last_sent
    from public.vendor_messages m, since
    where m.channel = 'gmail' and m.direction = 'outbound' and m.created_at >= since.t
  ),
  daily as (
    select date_trunc('day', s.created_at)::date as day, s.category, count(*) as sent
    from sends s
    where s.status = 'sent'
    group by 1, 2
  )
  select jsonb_build_object(
    'since', (select t from since),
    'tracking_started', (select min(created_at) from public.email_sends),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', c.category,
        'lane', c.lane,
        'provider', c.provider,
        'sent', c.sent,
        'rejected', c.rejected,
        'failed', c.failed,
        'delivered', c.delivered,
        'bounced', c.bounced,
        'complained', c.complained,
        'tracked', c.tracked,
        'unsubscribed', coalesce(u.n, 0),
        'last_sent', c.last_sent
      ) order by c.sent desc)
      from per_category c
      left join unsubs u on u.category = c.category
    ), '[]'::jsonb),
    'unsubscribes', coalesce((select jsonb_object_agg(category, n) from unsubs), '{}'::jsonb),
    'gmail', (select jsonb_build_object('sent', sent, 'last_sent', last_sent) from gmail),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'category', category, 'sent', sent) order by day)
      from daily
    ), '[]'::jsonb)
  );
$$;

-- The latest sends, newest first, optionally narrowed to one category or an
-- address / subject search.
create or replace function public.admin_recent_email_sends(
  p_limit integer default 100,
  p_category text default null,
  p_search text default null
)
returns table (
  id uuid,
  created_at timestamptz,
  category text,
  lane text,
  provider text,
  to_email text,
  subject text,
  status text,
  error text,
  delivered_at timestamptz,
  bounced_at timestamptz,
  bounce_type text,
  complained_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.created_at, s.category, s.lane, s.provider, s.to_email, s.subject, s.status, s.error,
         s.delivered_at, s.bounced_at, s.bounce_type, s.complained_at
  from public.email_sends s
  where (nullif(p_category, '') is null or s.category = p_category)
    and (nullif(trim(coalesce(p_search, '')), '') is null
         or s.to_email ilike '%' || trim(p_search) || '%'
         or s.subject ilike '%' || trim(p_search) || '%')
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.record_email_event(text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.admin_email_report(integer) from public, anon, authenticated;
revoke all on function public.admin_recent_email_sends(integer, text, text) from public, anon, authenticated;
grant execute on function public.record_email_event(text, text, timestamptz, text) to service_role;
grant execute on function public.admin_email_report(integer) to service_role;
grant execute on function public.admin_recent_email_sends(integer, text, text) to service_role;
