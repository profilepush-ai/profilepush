-- Website Modernization, part 3: goal-based enquiries, analytics, enquiry
-- alert and daily report settings, custom domains, and what the admin
-- Website Demos page and the demo generator need.

-- ── Sites: generator output and domain state ─────────────────────────────
alter table public.websites
  add column if not exists template text,
  add column if not exists content jsonb,
  add column if not exists daily_report boolean not null default true,
  add column if not exists domain_status text check (domain_status in ('pending', 'active', 'failed')),
  add column if not exists cf_hostname_id text;

grant select (daily_report, domain_status, template) on public.websites to authenticated;

-- ── Enquiry types follow each site's goals ───────────────────────────────
-- candidate: job seeker · consultant: consultant/training-to-placement program
-- employer: company hiring · partner: vendor/subvendor · training: course enquiry
alter table public.website_submissions drop constraint if exists website_submissions_kind_check;
alter table public.website_submissions add constraint website_submissions_kind_check
  check (kind in ('candidate', 'consultant', 'employer', 'partner', 'training', 'contact'));

-- ── Analytics ────────────────────────────────────────────────────────────
-- One row per event, written by the website-host Worker. visitor is a
-- salted daily hash (no IP or cookie stored), so "visitors" means distinct
-- visitors per day. Demo views are kept too: they show which pitched firms
-- opened their demo.
create table if not exists public.website_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  website_id uuid not null references public.websites(id) on delete cascade,
  type text not null check (type in ('pageview', 'cta', 'submit')),
  label text check (char_length(label) <= 60),
  path text check (char_length(path) <= 200),
  referrer text check (char_length(referrer) <= 200),
  country text check (char_length(country) <= 2),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  visitor text check (char_length(visitor) <= 64),
  is_demo boolean not null default false
);

create index if not exists website_events_site_time_idx on public.website_events (website_id, created_at desc);

alter table public.website_events enable row level security;
revoke all on public.website_events from public, anon, authenticated;
grant all on public.website_events to service_role;

create or replace function public.is_website_member(p_website_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.websites w
    join public.account_members m on m.account_id = w.account_id
    where w.id = p_website_id and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

revoke all on function public.is_website_member(uuid) from public, anon;
grant execute on function public.is_website_member(uuid) to authenticated;

-- Totals, a daily series, and top sources/countries/devices/CTAs for the
-- last p_days days of live traffic. Members of the owning account, or the
-- service role (admin), only.
create or replace function public.get_website_analytics(p_website_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_website_member(p_website_id) then
    raise exception 'Not allowed';
  end if;

  with ev as (
    select * from public.website_events e
    where e.website_id = p_website_id and e.created_at >= v_since and not e.is_demo
  ),
  days as (
    select generate_series(v_since, date_trunc('day', now()), interval '1 day')::date as day
  ),
  subs as (
    select s.created_at::date as day, s.kind from public.website_submissions s
    where s.website_id = p_website_id and s.created_at >= v_since
  )
  select jsonb_build_object(
    'days', v_days,
    'totals', jsonb_build_object(
      'visitors', (select count(distinct (visitor, created_at::date)) from ev where type = 'pageview'),
      'pageviews', (select count(*) from ev where type = 'pageview'),
      'cta_clicks', (select count(*) from ev where type = 'cta'),
      'enquiries', (select count(*) from subs)
    ),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'visitors', (select count(distinct visitor) from ev where type = 'pageview' and created_at::date = d.day),
        'pageviews', (select count(*) from ev where type = 'pageview' and created_at::date = d.day),
        'enquiries', (select count(*) from subs where subs.day = d.day)
      ) order by d.day), '[]'::jsonb)
      from days d
    ),
    'enquiries_by_kind', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from subs group by kind) k
    ),
    'referrers', (
      select coalesce(jsonb_agg(jsonb_build_object('name', r, 'count', n) order by n desc), '[]'::jsonb)
      from (select coalesce(nullif(referrer, ''), 'Direct') r, count(*) n from ev where type = 'pageview' group by 1 order by 2 desc limit 8) x
    ),
    'countries', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c, 'count', n) order by n desc), '[]'::jsonb)
      from (select coalesce(country, '??') c, count(*) n from ev where type = 'pageview' group by 1 order by 2 desc limit 8) x
    ),
    'devices', (
      select coalesce(jsonb_object_agg(coalesce(device, 'desktop'), n), '{}'::jsonb)
      from (select device, count(*) n from ev where type = 'pageview' group by device) x
    ),
    'ctas', (
      select coalesce(jsonb_agg(jsonb_build_object('name', l, 'count', n) order by n desc), '[]'::jsonb)
      from (select coalesce(label, 'other') l, count(*) n from ev where type = 'cta' group by 1 order by 2 desc limit 8) x
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_website_analytics(uuid, integer) from public, anon;
grant execute on function public.get_website_analytics(uuid, integer) to authenticated, service_role;

-- ── Notification settings ────────────────────────────────────────────────
-- Who gets enquiry alerts and the daily report. Empty list = the account's
-- members.
create or replace function public.update_website_notifications(p_website_id uuid, p_emails text[], p_daily_report boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emails text[];
begin
  if not public.is_website_member(p_website_id) then raise exception 'Not allowed'; end if;
  select coalesce(array_agg(distinct lower(trim(e))), '{}') into v_emails
  from unnest(coalesce(p_emails, '{}')) e where trim(e) <> '';
  if cardinality(v_emails) > 10 then raise exception 'Up to 10 email addresses.'; end if;
  if exists (select 1 from unnest(v_emails) e where e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'One of the email addresses is not valid.';
  end if;
  update public.websites set notify_emails = v_emails, daily_report = coalesce(p_daily_report, true), updated_at = now()
  where id = p_website_id;
end;
$$;

revoke all on function public.update_website_notifications(uuid, text[], boolean) from public, anon;
grant execute on function public.update_website_notifications(uuid, text[], boolean) to authenticated;

-- ── Serving: showcase flag; custom domains match with or without www ─────
-- A showcase site is a demo we feature on profilepush.ai/websites as an
-- example: it gets an "Example website" bar instead of the claim bar.
alter table public.websites add column if not exists showcase boolean not null default false;

drop function if exists public.website_for_request(text, text);
create or replace function public.website_for_request(p_slug text, p_host text)
returns table (
  id uuid, slug text, name text, html text, status text, live boolean,
  claimed boolean, claim_token text, demo_expired boolean, alert_emails text[], showcase boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.slug, w.name, w.html, w.status,
    (w.status = 'live' and w.account_id is not null and coalesce(a.website_plan_expires_at > now(), false)),
    w.account_id is not null,
    w.claim_token,
    (w.account_id is null and not w.showcase and w.demo_expires_at is not null and w.demo_expires_at < now()),
    case
      when cardinality(w.notify_emails) > 0 then w.notify_emails
      else coalesce((
        select array_agg(u.email::text) from public.account_members m
        join auth.users u on u.id = m.user_id
        where m.account_id = w.account_id and m.status = 'active' and u.email is not null
      ), '{}')
    end,
    w.showcase
  from public.websites w
  left join public.accounts a on a.id = w.account_id
  where (p_slug is not null and w.slug = lower(p_slug))
     or (p_host is not null and w.custom_domain is not null and (
          w.custom_domain = lower(p_host)
          or regexp_replace(w.custom_domain, '^www\.', '') = regexp_replace(lower(p_host), '^www\.', '')
        ))
  limit 1
$$;

revoke all on function public.website_for_request(text, text) from public, anon, authenticated;
grant execute on function public.website_for_request(text, text) to service_role;

-- ── Daily report (Worker cron, service role) ─────────────────────────────
-- Yesterday (UTC) for every live site with the report on and any activity.
create or replace function public.website_daily_reports()
returns table (website_id uuid, name text, recipients text[], report jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select r.* , w.daily_report
    from public.websites w
    cross join lateral public.website_for_request(w.slug, null) r
    where w.status = 'live' and w.account_id is not null
  ),
  y as (select date_trunc('day', now()) - interval '1 day' as start, date_trunc('day', now()) as finish)
  select l.id, l.name, l.alert_emails,
    jsonb_build_object(
      'date', (select start::date from y),
      'visitors', (select count(distinct e.visitor) from public.website_events e, y where e.website_id = l.id and e.type = 'pageview' and not e.is_demo and e.created_at >= y.start and e.created_at < y.finish),
      'pageviews', (select count(*) from public.website_events e, y where e.website_id = l.id and e.type = 'pageview' and not e.is_demo and e.created_at >= y.start and e.created_at < y.finish),
      'cta_clicks', (select count(*) from public.website_events e, y where e.website_id = l.id and e.type = 'cta' and not e.is_demo and e.created_at >= y.start and e.created_at < y.finish),
      'enquiries', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select s.kind, count(*) n from public.website_submissions s, y where s.website_id = l.id and s.created_at >= y.start and s.created_at < y.finish group by s.kind) k),
      'referrers', (select coalesce(jsonb_agg(jsonb_build_object('name', r, 'count', n) order by n desc), '[]'::jsonb) from (select coalesce(nullif(e.referrer, ''), 'Direct') r, count(*) n from public.website_events e, y where e.website_id = l.id and e.type = 'pageview' and not e.is_demo and e.created_at >= y.start and e.created_at < y.finish group by 1 order by 2 desc limit 5) x)
    )
  from live l
  where l.live and l.daily_report
$$;

revoke all on function public.website_daily_reports() from public, anon, authenticated;
grant execute on function public.website_daily_reports() to service_role;

-- ── Admin overview (admin-websites function, service role) ───────────────
create or replace function public.admin_website_overview()
returns table (
  id uuid, slug text, name text, source_url text, status text, live boolean, account_id uuid,
  account_name text, created_at timestamptz, claimed_at timestamptz, demo_expires_at timestamptz,
  custom_domain text, domain_status text, template text, claim_token text, claim_domain text,
  claim_emails text[], plan_expires_at timestamptz, demo_views bigint, last_demo_view timestamptz,
  visitors_30d bigint, enquiries_total bigint, enquiries_30d bigint, showcase boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.slug, w.name, w.source_url, w.status,
    (w.status = 'live' and w.account_id is not null and coalesce(a.website_plan_expires_at > now(), false)),
    w.account_id, a.name, w.created_at, w.claimed_at, w.demo_expires_at,
    w.custom_domain, w.domain_status, w.template, w.claim_token, w.claim_domain, w.claim_emails,
    a.website_plan_expires_at,
    (select count(*) from public.website_events e where e.website_id = w.id and e.is_demo and e.type = 'pageview'),
    (select max(e.created_at) from public.website_events e where e.website_id = w.id and e.is_demo and e.type = 'pageview'),
    (select count(distinct (e.visitor, e.created_at::date)) from public.website_events e where e.website_id = w.id and not e.is_demo and e.type = 'pageview' and e.created_at > now() - interval '30 days'),
    (select count(*) from public.website_submissions s where s.website_id = w.id),
    (select count(*) from public.website_submissions s where s.website_id = w.id and s.created_at > now() - interval '30 days'),
    w.showcase
  from public.websites w
  left join public.accounts a on a.id = w.account_id
  order by w.created_at desc
$$;

revoke all on function public.admin_website_overview() from public, anon, authenticated;
grant execute on function public.admin_website_overview() to service_role;

-- ── Demo generation jobs ─────────────────────────────────────────────────
-- A demo request is also the generation job: admin-websites starts it in the
-- background and the admin page polls these columns.
alter table public.website_demo_requests
  add column if not exists generation_status text check (generation_status in ('queued', 'running', 'done', 'failed')),
  add column if not exists generation_error text,
  add column if not exists generated_at timestamptz,
  add column if not exists website_id uuid references public.websites(id) on delete set null,
  add column if not exists template text;

