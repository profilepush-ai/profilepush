-- Open and click tracking for every email the email worker sends.
--
-- The worker gives each send an id (email_sends.id) before sending, adds a
-- 1x1 image (/o/<id>.gif) and routes each link through /c/<id> on
-- t.profilepush.ai, then records the first open and click (and counts) here.
-- Opens are approximate: Apple Mail loads images for privacy, which counts as
-- an open, and some mail servers load them or follow links to scan them.
-- Clicks are the more reliable signal.

alter table public.email_sends
  add column if not exists opened_at timestamptz,
  add column if not exists open_count integer not null default 0,
  add column if not exists clicked_at timestamptz,
  add column if not exists click_count integer not null default 0,
  -- Whether this email carried the image and tracked links: open and click
  -- rates are out of these, so emails sent before tracking don't drag them down.
  add column if not exists engagement_tracked boolean not null default false;

create or replace function public.record_email_open(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_sends
  set opened_at = coalesce(opened_at, now()), open_count = open_count + 1
  where id = p_id;
$$;

-- A click means the email was opened too, even if images were blocked.
create or replace function public.record_email_click(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_sends
  set clicked_at = coalesce(clicked_at, now()), click_count = click_count + 1,
      opened_at = coalesce(opened_at, now())
  where id = p_id;
$$;

revoke all on function public.record_email_open(uuid) from public, anon, authenticated;
revoke all on function public.record_email_click(uuid) from public, anon, authenticated;
grant execute on function public.record_email_open(uuid) to service_role;
grant execute on function public.record_email_click(uuid) to service_role;

-- The Emails report, now with opens and clicks per category.
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
      count(*) filter (where s.status = 'sent' and s.engagement_tracked) as engagement_tracked,
      count(*) filter (where s.opened_at is not null) as opened,
      count(*) filter (where s.clicked_at is not null) as clicked,
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
        'engagement_tracked', c.engagement_tracked,
        'opened', c.opened,
        'clicked', c.clicked,
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

drop function if exists public.admin_campaign_report();
create function public.admin_campaign_report()
returns table (
  id uuid,
  created_at timestamptz,
  subject text,
  audience text,
  status text,
  recipient_count integer,
  sent integer,
  delivered integer,
  bounced integer,
  complained integer,
  failed integer,
  unsubscribed integer,
  opened integer,
  clicked integer,
  engagement_tracked boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.created_at, c.subject, c.audience, c.status, c.recipient_count,
    (select count(*) from public.email_sends s where s.campaign_id = c.id and s.status = 'sent')::int,
    (select count(*) from public.email_sends s where s.campaign_id = c.id and s.delivered_at is not null)::int,
    (select count(*) from public.email_sends s where s.campaign_id = c.id and s.bounced_at is not null)::int,
    (select count(*) from public.email_sends s where s.campaign_id = c.id and s.complained_at is not null)::int,
    (select count(*) from public.email_sends s where s.campaign_id = c.id and s.status in ('failed', 'rejected'))::int,
    (select count(*) from public.email_unsubscribes u where u.campaign_id = c.id)::int,
    (select count(*) from public.email_sends s where s.campaign_id = c.id and s.opened_at is not null)::int,
    (select count(*) from public.email_sends s where s.campaign_id = c.id and s.clicked_at is not null)::int,
    exists (select 1 from public.email_sends s where s.campaign_id = c.id and s.engagement_tracked)
  from public.email_campaigns c
  order by c.created_at desc
  limit 100;
$$;

drop function if exists public.admin_recent_email_sends(integer, text, text);
create function public.admin_recent_email_sends(
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
  complained_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.created_at, s.category, s.lane, s.provider, s.to_email, s.subject, s.status, s.error,
         s.delivered_at, s.bounced_at, s.bounce_type, s.complained_at, s.opened_at, s.clicked_at
  from public.email_sends s
  where (nullif(p_category, '') is null or s.category = p_category)
    and (nullif(trim(coalesce(p_search, '')), '') is null
         or s.to_email ilike '%' || trim(p_search) || '%'
         or s.subject ilike '%' || trim(p_search) || '%')
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.admin_email_report(integer) from public, anon, authenticated;
revoke all on function public.admin_campaign_report() from public, anon, authenticated;
revoke all on function public.admin_recent_email_sends(integer, text, text) from public, anon, authenticated;
grant execute on function public.admin_email_report(integer) to service_role;
grant execute on function public.admin_campaign_report() to service_role;
grant execute on function public.admin_recent_email_sends(integer, text, text) to service_role;
