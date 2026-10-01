-- Admin > Emails > Compose: write an email, pick who gets it, send it.
--
-- email_campaigns holds each email written in admin; every send it makes is
-- an email_sends row with its campaign_id, so a campaign's delivery, bounces
-- and unsubscribes come from the same log as every other email. People who
-- unsubscribe from campaign emails get notification_preferences
-- 'announcements' turned off and are left out of every later campaign.
--
-- user_app_installs records who uses the Android app (the app loads the live
-- site, so it reports itself on open), for the "users without the app"
-- audience.

create table if not exists public.user_app_installs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  platform text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.user_app_installs enable row level security;
revoke all on public.user_app_installs from public, anon, authenticated;
grant select, insert, update on public.user_app_installs to service_role;

create or replace function public.record_app_install(p_platform text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_app_installs (user_id, platform)
  select auth.uid(), left(coalesce(nullif(p_platform, ''), 'unknown'), 20)
  where auth.uid() is not null
  on conflict (user_id) do update set platform = excluded.platform, last_seen_at = now();
$$;

revoke all on function public.record_app_install(text) from public, anon;
grant execute on function public.record_app_install(text) to authenticated;

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subject text not null,
  body text not null,
  button_label text,
  button_url text,
  audience text not null,
  recipient_count integer not null default 0,
  status text not null default 'sending',
  sent_at timestamptz
);

alter table public.email_campaigns enable row level security;
revoke all on public.email_campaigns from public, anon, authenticated;
grant select, insert, update on public.email_campaigns to service_role;

alter table public.email_sends add column if not exists campaign_id uuid references public.email_campaigns(id) on delete set null;
alter table public.email_unsubscribes add column if not exists campaign_id uuid references public.email_campaigns(id) on delete set null;
create index if not exists email_sends_campaign_id_idx on public.email_sends (campaign_id) where campaign_id is not null;

-- Who a campaign goes to. Always leaves out anyone who unsubscribed from
-- campaign emails, and any address that hard-bounced or complained before.
--   all          every user with a confirmed email
--   vendors      users whose account persona is vendor
--   bench_sales  users whose account persona is bench sales
--   no_app       users not seen in the Android app
--   inactive_7d  users with no activity in the last 7 days
--   emails       only the addresses in p_emails (that belong to users)
create or replace function public.admin_campaign_recipients(p_audience text, p_emails text[] default null)
returns table (user_id uuid, account_id uuid, email text, first_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (lower(u.email))
    u.id,
    am.account_id,
    u.email::text,
    nullif(initcap(split_part(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ' ', 1)), '')
  from auth.users u
  join public.account_members am on am.user_id = u.id and am.status = 'active'
  join public.accounts a on a.id = am.account_id
  where u.email is not null
    and u.email_confirmed_at is not null
    and not exists (
      select 1 from public.notification_preferences np
      where np.user_id = u.id and np.notif_type = 'announcements' and np.email_enabled = false
    )
    and not exists (
      select 1 from public.email_sends s
      where lower(s.to_email) = lower(u.email)
        and (s.complained_at is not null or s.bounce_type like 'Permanent%')
    )
    and case p_audience
      when 'all' then true
      when 'vendors' then a.active_persona = 'vendor'
      when 'bench_sales' then a.active_persona = 'bench_sales'
      when 'no_app' then not exists (select 1 from public.user_app_installs i where i.user_id = u.id)
      when 'inactive_7d' then not exists (
        select 1 from public.user_activity_daily d
        where d.user_id = u.id and d.activity_date >= (now() - interval '7 days')::date
      )
      when 'emails' then lower(u.email) = any (select lower(trim(e)) from unnest(coalesce(p_emails, '{}'::text[])) e)
      else false
    end
  order by lower(u.email), am.created_at asc;
$$;

-- Every campaign with how it did.
create or replace function public.admin_campaign_report()
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
  unsubscribed integer
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
    (select count(*) from public.email_unsubscribes u where u.campaign_id = c.id)::int
  from public.email_campaigns c
  order by c.created_at desc
  limit 100;
$$;

revoke all on function public.admin_campaign_recipients(text, text[]) from public, anon, authenticated;
revoke all on function public.admin_campaign_report() from public, anon, authenticated;
grant execute on function public.admin_campaign_recipients(text, text[]) to service_role;
grant execute on function public.admin_campaign_report() to service_role;
