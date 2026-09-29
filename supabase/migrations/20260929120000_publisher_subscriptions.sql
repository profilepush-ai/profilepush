-- Subscriptions, phase 1: publisher profiles, follows and the following feed.
--
-- A publisher is one poster email. Vendors publish requirements (social_jobs),
-- bench sales recruiters publish hotlists (social_hotlist); the same email can
-- do both, so there is one profile per email, not per kind.
--
-- Posts are linked to a profile by normalized email, not by a new column on
-- the post tables. Backfilling a column would UPDATE every recent social_jobs
-- row, and fulfill_asked_jobs_on_social_job_update fires on any UPDATE there —
-- it marks ask requests fulfilled and sends notifications. An expression index
-- gives the same lookup without touching a single post row.
--
-- The follow tables are publisher_follows / publisher_follow_log: the name
-- `subscriptions` is already the Razorpay billing table.
--
-- Nothing here is readable directly by clients. Profiles carry the poster's
-- email, which the app only shows through the existing reveal flow, so every
-- read goes through a SECURITY DEFINER function that leaves it out.

-- ── Email key ──────────────────────────────────────────────────────────────
-- Some poster emails are comma-joined lists; the Active List RPCs already take
-- the first one (20260823170000). Same rule here, so a profile and the Active
-- List agree on who a poster is.
create or replace function public.publisher_email_key(p_email text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(trim(split_part(coalesce(p_email, ''), ',', 1)))
$$;

create index if not exists social_jobs_publisher_email_key_idx
  on public.social_jobs (public.publisher_email_key(poster_email), created_at desc)
  where poster_email <> '';

create index if not exists social_hotlist_publisher_email_key_idx
  on public.social_hotlist (public.publisher_email_key(bench_sales_recruiter_email), created_at desc)
  where bench_sales_recruiter_email <> '';

-- ── Profiles ───────────────────────────────────────────────────────────────
create table if not exists public.publisher_profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  slug text not null unique,
  display_name text not null default '',
  company_name text not null default '',
  avatar_url text not null default '',
  linkedin_url text not null default '',
  -- Set when someone signs up (or already has an account) with this email.
  -- No other verification: owning the inbox is the claim.
  claimed_account_id uuid references public.accounts(id) on delete set null,
  claimed_at timestamptz,
  last_job_post_at timestamptz,
  last_hotlist_post_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publisher_profiles_email_normalized_check check (email = lower(trim(email)) and email <> '')
);

create index if not exists publisher_profiles_claimed_account_idx
  on public.publisher_profiles (claimed_account_id)
  where claimed_account_id is not null;

alter table public.publisher_profiles enable row level security;
revoke all on public.publisher_profiles from anon, authenticated;
grant select, insert, update, delete on public.publisher_profiles to service_role;

-- Slug: readable name plus a short hash of the email, so two "John Smith"s
-- never collide and the slug never exposes the email itself. Set once at
-- insert; a later name change keeps the link stable.
create or replace function public.publisher_profiles_set_slug()
returns trigger
language plpgsql
as $$
declare
  v_base text;
begin
  if new.slug is not null and new.slug <> '' then
    return new;
  end if;
  v_base := trim(both '-' from regexp_replace(
    lower(coalesce(nullif(trim(new.display_name), ''), nullif(trim(new.company_name), ''), 'recruiter')),
    '[^a-z0-9]+', '-', 'g'
  ));
  if v_base = '' then v_base := 'recruiter'; end if;
  new.slug := left(v_base, 40) || '-' || substr(md5(new.email), 1, 6);
  return new;
end;
$$;

drop trigger if exists publisher_profiles_set_slug_before_insert on public.publisher_profiles;
create trigger publisher_profiles_set_slug_before_insert
  before insert on public.publisher_profiles
  for each row execute function public.publisher_profiles_set_slug();

-- The earliest active membership, same rule every other account-scoped
-- function uses (get_ai_submit_quota, claim_scraped_job_post).
create or replace function public.publisher_account_for_user(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select am.account_id
  from public.account_members am
  where am.user_id = p_user_id and am.status = 'active'
  order by am.created_at asc
  limit 1
$$;

revoke all on function public.publisher_account_for_user(uuid) from public, anon, authenticated;

-- Upsert the profile for one post. Non-empty values win, so a post without a
-- photo never blanks one another post supplied. A profile that nobody has
-- claimed yet is claimed on the spot when the email already belongs to a
-- confirmed ProfilePush user.
create or replace function public.upsert_publisher_profile(
  p_email text,
  p_name text,
  p_company text,
  p_avatar text,
  p_linkedin text,
  p_kind text,
  p_posted_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := public.publisher_email_key(p_email);
  v_id uuid;
  v_claimed uuid;
  v_user_id uuid;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return null;
  end if;

  insert into public.publisher_profiles (
    email, display_name, company_name, avatar_url, linkedin_url,
    last_job_post_at, last_hotlist_post_at
  )
  values (
    v_email,
    trim(coalesce(p_name, '')),
    trim(coalesce(p_company, '')),
    trim(coalesce(p_avatar, '')),
    trim(coalesce(p_linkedin, '')),
    case when p_kind = 'job' then p_posted_at end,
    case when p_kind = 'hotlist' then p_posted_at end
  )
  on conflict (email) do update set
    display_name = case when excluded.display_name <> '' then excluded.display_name else publisher_profiles.display_name end,
    company_name = case when excluded.company_name <> '' then excluded.company_name else publisher_profiles.company_name end,
    avatar_url = case when excluded.avatar_url <> '' then excluded.avatar_url else publisher_profiles.avatar_url end,
    linkedin_url = case when excluded.linkedin_url <> '' then excluded.linkedin_url else publisher_profiles.linkedin_url end,
    last_job_post_at = greatest(publisher_profiles.last_job_post_at, excluded.last_job_post_at),
    last_hotlist_post_at = greatest(publisher_profiles.last_hotlist_post_at, excluded.last_hotlist_post_at),
    updated_at = now()
  returning id, claimed_account_id into v_id, v_claimed;

  if v_claimed is null then
    select u.id into v_user_id
    from auth.users u
    where lower(trim(u.email)) = v_email and u.email_confirmed_at is not null
    limit 1;
    if v_user_id is not null then
      update public.publisher_profiles
      set claimed_account_id = public.publisher_account_for_user(v_user_id),
          claimed_at = now()
      where id = v_id and claimed_account_id is null
        and public.publisher_account_for_user(v_user_id) is not null;
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.upsert_publisher_profile(text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_publisher_profile(text, text, text, text, text, text, timestamptz) to service_role;

-- AFTER triggers that never modify the post row: they only keep the profile
-- current as posts arrive from any path (the app, AI Match, imports).
create or replace function public.sync_publisher_profile_from_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.poster_email, '') <> '' then
    perform public.upsert_publisher_profile(
      new.poster_email, new.posted_by_name, new.company_name, new.avatar_url,
      new.profile_link, 'job', coalesce(new.posted_at, new.created_at)
    );
  end if;
  return null;
end;
$$;

create or replace function public.sync_publisher_profile_from_hotlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.bench_sales_recruiter_email, '') <> '' then
    perform public.upsert_publisher_profile(
      new.bench_sales_recruiter_email, new.bench_sales_recruiter_name, new.bench_sales_company_name,
      new.bench_sales_recruiter_avatar_url, new.recruiter_profile_link, 'hotlist',
      coalesce(new.posted_at, new.created_at)
    );
  end if;
  return null;
end;
$$;

revoke all on function public.sync_publisher_profile_from_job() from public, anon, authenticated;
revoke all on function public.sync_publisher_profile_from_hotlist() from public, anon, authenticated;

drop trigger if exists sync_publisher_profile_after_write on public.social_jobs;
create trigger sync_publisher_profile_after_write
  after insert or update of poster_email, posted_by_name, company_name, avatar_url, profile_link
  on public.social_jobs
  for each row execute function public.sync_publisher_profile_from_job();

drop trigger if exists sync_publisher_profile_after_write on public.social_hotlist;
create trigger sync_publisher_profile_after_write
  after insert or update of bench_sales_recruiter_email, bench_sales_recruiter_name, bench_sales_company_name,
    bench_sales_recruiter_avatar_url, recruiter_profile_link
  on public.social_hotlist
  for each row execute function public.sync_publisher_profile_from_hotlist();

-- Backfill from the last 45 days — enough for every feed window (30 days) and
-- the match-email window (7 days). Reads only; no post row is written.
insert into public.publisher_profiles (email, display_name, company_name, avatar_url, linkedin_url, last_job_post_at)
select distinct on (public.publisher_email_key(j.poster_email))
  public.publisher_email_key(j.poster_email),
  trim(j.posted_by_name), trim(j.company_name), trim(coalesce(j.avatar_url, '')), trim(j.profile_link),
  max(coalesce(j.posted_at, j.created_at)) over (partition by public.publisher_email_key(j.poster_email))
from public.social_jobs j
where j.poster_email <> ''
  and j.created_at >= now() - interval '45 days'
  and position('@' in public.publisher_email_key(j.poster_email)) > 0
order by public.publisher_email_key(j.poster_email), j.created_at desc
on conflict (email) do nothing;

insert into public.publisher_profiles (email, display_name, company_name, avatar_url, linkedin_url, last_hotlist_post_at)
select distinct on (public.publisher_email_key(h.bench_sales_recruiter_email))
  public.publisher_email_key(h.bench_sales_recruiter_email),
  trim(h.bench_sales_recruiter_name), trim(h.bench_sales_company_name),
  trim(coalesce(h.bench_sales_recruiter_avatar_url, '')), trim(h.recruiter_profile_link),
  max(coalesce(h.posted_at, h.created_at)) over (partition by public.publisher_email_key(h.bench_sales_recruiter_email))
from public.social_hotlist h
where h.bench_sales_recruiter_email <> ''
  and h.created_at >= now() - interval '45 days'
  and position('@' in public.publisher_email_key(h.bench_sales_recruiter_email)) > 0
order by public.publisher_email_key(h.bench_sales_recruiter_email), h.created_at desc
on conflict (email) do update set
  last_hotlist_post_at = excluded.last_hotlist_post_at,
  display_name = case when publisher_profiles.display_name = '' then excluded.display_name else publisher_profiles.display_name end,
  company_name = case when publisher_profiles.company_name = '' then excluded.company_name else publisher_profiles.company_name end,
  avatar_url = case when publisher_profiles.avatar_url = '' then excluded.avatar_url else publisher_profiles.avatar_url end;

-- Claim every backfilled profile whose email already belongs to a confirmed user.
update public.publisher_profiles p
set claimed_account_id = public.publisher_account_for_user(u.id),
    claimed_at = now()
from auth.users u
where p.claimed_account_id is null
  and lower(trim(u.email)) = p.email
  and u.email_confirmed_at is not null
  and public.publisher_account_for_user(u.id) is not null;

-- Called by the client after sign-in / account creation. A new signup with a
-- known email picks up the profile here; the confirmed-email check stops
-- someone taking a vendor's profile by signing up with their address and a
-- password before the inbox is proven.
create or replace function public.claim_my_publisher_profile()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_account uuid;
  v_count integer;
begin
  if auth.uid() is null then return 0; end if;
  select lower(trim(u.email)) into v_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null or v_email = '' then return 0; end if;
  v_account := public.publisher_account_for_user(auth.uid());
  if v_account is null then return 0; end if;

  update public.publisher_profiles
  set claimed_account_id = v_account, claimed_at = now(), updated_at = now()
  where email = v_email and claimed_account_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_my_publisher_profile() from public, anon;
grant execute on function public.claim_my_publisher_profile() to authenticated;

-- ── Follows ────────────────────────────────────────────────────────────────
create table if not exists public.publisher_follows (
  account_id uuid not null references public.accounts(id) on delete cascade,
  publisher_id uuid not null references public.publisher_profiles(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  muted boolean not null default false,
  -- Posts after this are "new". Starts three days back so a fresh follow shows
  -- the publisher's recent posts instead of an empty card.
  last_seen_at timestamptz not null default (now() - interval '3 days'),
  created_at timestamptz not null default now(),
  primary key (account_id, publisher_id)
);

create index if not exists publisher_follows_publisher_idx on public.publisher_follows (publisher_id);

-- One row per follow action, kept after an unfollow, so the daily limit
-- counts actions: unfollowing and refollowing cannot reset it.
create table if not exists public.publisher_follow_log (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  publisher_id uuid not null references public.publisher_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists publisher_follow_log_account_day_idx
  on public.publisher_follow_log (account_id, created_at desc);

alter table public.publisher_follows enable row level security;
alter table public.publisher_follow_log enable row level security;
revoke all on public.publisher_follows from anon, authenticated;
revoke all on public.publisher_follow_log from anon, authenticated;
grant select, insert, update, delete on public.publisher_follows to service_role;
grant select, insert, update, delete on public.publisher_follow_log to service_role;

-- Free accounts 5 new subscriptions a day, paid 20. UTC day, like
-- get_ai_submit_quota, so the window cannot be reset by changing timezone.
create or replace function public.get_follow_quota()
returns table (used_today integer, daily_limit integer, remaining integer, is_trial boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_trial boolean;
  v_used integer;
  v_limit integer;
begin
  if v_account is null then
    return query select 0, 0, 0, true;
    return;
  end if;
  select coalesce(a.is_trial, true) into v_trial from public.accounts a where a.id = v_account;
  v_limit := case when v_trial then 5 else 20 end;
  select count(*)::integer into v_used
  from public.publisher_follow_log l
  where l.account_id = v_account
    and l.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  return query select v_used, v_limit, greatest(0, v_limit - v_used), v_trial;
end;
$$;

revoke all on function public.get_follow_quota() from public, anon;
grant execute on function public.get_follow_quota() to authenticated;

create or replace function public.follow_publisher(p_publisher_id uuid)
returns table (following boolean, used_today integer, daily_limit integer, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  q record;
begin
  if v_account is null then
    raise exception 'No active account membership found';
  end if;
  if not exists (select 1 from public.publisher_profiles where id = p_publisher_id) then
    raise exception 'Publisher not found';
  end if;
  if exists (select 1 from public.publisher_profiles where id = p_publisher_id and claimed_account_id = v_account) then
    raise exception 'You cannot subscribe to your own profile';
  end if;

  -- Already following: nothing to spend.
  if exists (select 1 from public.publisher_follows f where f.account_id = v_account and f.publisher_id = p_publisher_id) then
    select * into q from public.get_follow_quota();
    return query select true, q.used_today, q.daily_limit, q.remaining;
    return;
  end if;

  -- Serialize this account's follows so two taps cannot both pass the check.
  perform pg_advisory_xact_lock(hashtext('publisher_follow:' || v_account::text));
  select * into q from public.get_follow_quota();
  if q.remaining <= 0 then
    raise exception 'FOLLOW_LIMIT_REACHED:%', q.daily_limit;
  end if;

  insert into public.publisher_follows (account_id, publisher_id, user_id)
  values (v_account, p_publisher_id, auth.uid())
  on conflict (account_id, publisher_id) do nothing;
  insert into public.publisher_follow_log (account_id, publisher_id) values (v_account, p_publisher_id);

  return query select true, q.used_today + 1, q.daily_limit, greatest(0, q.remaining - 1);
end;
$$;

create or replace function public.unfollow_publisher(p_publisher_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.publisher_follows
  where account_id = public.publisher_account_for_user(auth.uid()) and publisher_id = p_publisher_id
$$;

create or replace function public.set_publisher_muted(p_publisher_id uuid, p_muted boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.publisher_follows set muted = p_muted
  where account_id = public.publisher_account_for_user(auth.uid()) and publisher_id = p_publisher_id
$$;

create or replace function public.mark_publisher_seen(p_publisher_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.publisher_follows set last_seen_at = now()
  where account_id = public.publisher_account_for_user(auth.uid()) and publisher_id = p_publisher_id
$$;

revoke all on function public.follow_publisher(uuid) from public, anon;
revoke all on function public.unfollow_publisher(uuid) from public, anon;
revoke all on function public.set_publisher_muted(uuid, boolean) from public, anon;
revoke all on function public.mark_publisher_seen(uuid) from public, anon;
grant execute on function public.follow_publisher(uuid) to authenticated;
grant execute on function public.unfollow_publisher(uuid) to authenticated;
grant execute on function public.set_publisher_muted(uuid, boolean) to authenticated;
grant execute on function public.mark_publisher_seen(uuid) to authenticated;

-- ── Reads ──────────────────────────────────────────────────────────────────
-- One row per post of the given kind for the given publishers, in the shape
-- the cards need. Hotlists are stored one row per consultant, so a hotlist
-- "post" is its source_post_id. Open, visible posts from the last 30 days —
-- the same rules and window as the main feeds.
create or replace function public.publisher_recent_posts(p_publisher_ids uuid[], p_kind text, p_days integer default 30)
returns table (
  publisher_id uuid,
  post_key text,
  lead_id uuid,
  posted_at timestamptz,
  roles text[],
  locations text[],
  job_types text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, j.id::text, j.id, coalesce(j.posted_at, j.created_at),
    array[coalesce(nullif(trim(j.extracted_role_normalized), ''), nullif(trim(j.job_title), ''), 'Role')],
    case when trim(j.location) <> '' then array[trim(j.location)] else '{}'::text[] end,
    case when trim(j.employment_type) <> '' then array[trim(j.employment_type)] else '{}'::text[] end
  from public.publisher_profiles p
  join public.social_jobs j
    on public.publisher_email_key(j.poster_email) = p.email and j.poster_email <> ''
  where p_kind = 'job'
    and p.id = any(p_publisher_ids)
    and j.created_at >= now() - make_interval(days => p_days)
    and j.hidden_at is null
    and coalesce(j.post_status, 'open') = 'open'
  union all
  select p.id, h.source_post_id, (array_agg(h.id order by h.candidate_index))[1],
    max(coalesce(h.posted_at, h.created_at)),
    array_agg(distinct coalesce(nullif(trim(h.role_title), ''), 'Consultant')),
    coalesce((select array_agg(distinct l) from public.social_hotlist h2, unnest(h2.locations) l
              where h2.source_post_id = h.source_post_id and trim(l) <> ''), '{}'::text[]),
    coalesce(array_agg(distinct trim(h.employment_type)) filter (where trim(h.employment_type) <> ''), '{}'::text[])
  from public.publisher_profiles p
  join public.social_hotlist h
    on public.publisher_email_key(h.bench_sales_recruiter_email) = p.email and h.bench_sales_recruiter_email <> ''
  where p_kind = 'hotlist'
    and p.id = any(p_publisher_ids)
    and h.created_at >= now() - make_interval(days => p_days)
    and h.hidden_at is null
    and coalesce(h.post_status, 'open') = 'open'
  group by p.id, h.source_post_id
$$;

revoke all on function public.publisher_recent_posts(uuid[], text, integer) from public, anon, authenticated;

-- The Vendors / Bench Recs feed: one card per followed publisher. p_kind is
-- what the viewer reads — 'job' for bench sales (vendors' requirements),
-- 'hotlist' for vendors (bench recruiters' hotlists).
create or replace function public.get_following_feed(p_kind text)
returns table (
  publisher_id uuid,
  slug text,
  display_name text,
  company_name text,
  avatar_url text,
  is_claimed boolean,
  muted boolean,
  unread_count integer,
  recent_count integer,
  latest_post_at timestamptz,
  top_roles text[],
  role_count integer,
  top_locations text[],
  job_types text[],
  first_unread_lead_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_ids uuid[];
begin
  if v_account is null or p_kind not in ('job', 'hotlist') then return; end if;
  select array_agg(f.publisher_id) into v_ids from public.publisher_follows f where f.account_id = v_account;
  if v_ids is null then return; end if;

  return query
  with posts as (
    select * from public.publisher_recent_posts(v_ids, p_kind, 30)
  ),
  follows as (
    select f.publisher_id, f.muted, f.last_seen_at from public.publisher_follows f where f.account_id = v_account
  ),
  agg as (
    select po.publisher_id,
      count(*) filter (where po.posted_at > fo.last_seen_at)::integer as unread_count,
      count(*)::integer as recent_count,
      max(po.posted_at) as latest_post_at,
      (array_agg(po.lead_id order by po.posted_at asc) filter (where po.posted_at > fo.last_seen_at))[1] as first_unread_lead_id
    from posts po join follows fo on fo.publisher_id = po.publisher_id
    group by po.publisher_id
  )
  select p.id, p.slug, p.display_name, p.company_name, p.avatar_url,
    p.claimed_account_id is not null, fo.muted,
    coalesce(a.unread_count, 0), coalesce(a.recent_count, 0), a.latest_post_at,
    coalesce((select array_agg(r) from (
      select r from posts po2, unnest(po2.roles) r where po2.publisher_id = p.id
      group by r order by count(*) desc, r limit 3) t), '{}'::text[]),
    coalesce((select count(distinct r)::integer from posts po2, unnest(po2.roles) r where po2.publisher_id = p.id), 0),
    coalesce((select array_agg(l) from (
      select l from posts po2, unnest(po2.locations) l where po2.publisher_id = p.id
      group by l order by count(*) desc, l limit 3) t), '{}'::text[]),
    coalesce((select array_agg(jt) from (
      select jt from posts po2, unnest(po2.job_types) jt where po2.publisher_id = p.id
      group by jt order by count(*) desc, jt limit 3) t), '{}'::text[]),
    a.first_unread_lead_id
  from follows fo
  join public.publisher_profiles p on p.id = fo.publisher_id
  left join agg a on a.publisher_id = p.id
  order by (coalesce(a.unread_count, 0) > 0) desc, a.latest_post_at desc nulls last, p.display_name;
end;
$$;

revoke all on function public.get_following_feed(text) from public, anon;
grant execute on function public.get_following_feed(text) to authenticated;

-- Publishers the viewer might follow: the most active of the kind they read
-- over the last 7 days, excluding ones they already follow and their own.
create or replace function public.get_suggested_publishers(p_kind text, p_limit integer default 12)
returns table (
  publisher_id uuid,
  slug text,
  display_name text,
  company_name text,
  avatar_url text,
  is_claimed boolean,
  post_count integer,
  top_roles text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_ids uuid[];
begin
  if v_account is null or p_kind not in ('job', 'hotlist') then return; end if;

  select array_agg(p.id) into v_ids
  from (
    select p.id
    from public.publisher_profiles p
    where (case when p_kind = 'job' then p.last_job_post_at else p.last_hotlist_post_at end) >= now() - interval '7 days'
      and p.claimed_account_id is distinct from v_account
      and not exists (select 1 from public.publisher_follows f where f.account_id = v_account and f.publisher_id = p.id)
    order by (case when p_kind = 'job' then p.last_job_post_at else p.last_hotlist_post_at end) desc
    limit 200
  ) p;
  if v_ids is null then return; end if;

  return query
  with posts as (
    select * from public.publisher_recent_posts(v_ids, p_kind, 7)
  )
  select p.id, p.slug, p.display_name, p.company_name, p.avatar_url, p.claimed_account_id is not null,
    count(*)::integer,
    coalesce((select array_agg(r) from (
      select r from posts po2, unnest(po2.roles) r where po2.publisher_id = p.id
      group by r order by count(*) desc, r limit 3) t), '{}'::text[])
  from posts po
  join public.publisher_profiles p on p.id = po.publisher_id
  group by p.id
  order by count(*) desc, max(po.posted_at) desc
  limit greatest(1, least(coalesce(p_limit, 12), 50));
end;
$$;

revoke all on function public.get_suggested_publishers(text, integer) from public, anon;
grant execute on function public.get_suggested_publishers(text, integer) to authenticated;

create or replace function public.get_publisher_profile(p_slug text)
returns table (
  publisher_id uuid,
  slug text,
  display_name text,
  company_name text,
  avatar_url text,
  linkedin_url text,
  is_claimed boolean,
  is_mine boolean,
  is_following boolean,
  muted boolean,
  last_seen_at timestamptz,
  follower_count integer,
  job_post_count integer,
  hotlist_post_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_profile public.publisher_profiles%rowtype;
begin
  select * into v_profile from public.publisher_profiles pp where pp.slug = p_slug;
  if not found then return; end if;

  return query
  select v_profile.id, v_profile.slug, v_profile.display_name, v_profile.company_name,
    v_profile.avatar_url, v_profile.linkedin_url,
    v_profile.claimed_account_id is not null,
    v_account is not null and v_profile.claimed_account_id = v_account,
    f.account_id is not null, coalesce(f.muted, false), f.last_seen_at,
    (select count(*)::integer from public.publisher_follows f2 where f2.publisher_id = v_profile.id),
    (select count(*)::integer from public.publisher_recent_posts(array[v_profile.id], 'job', 30)),
    (select count(*)::integer from public.publisher_recent_posts(array[v_profile.id], 'hotlist', 30))
  from (select 1) one
  left join public.publisher_follows f on f.account_id = v_account and f.publisher_id = v_profile.id;
end;
$$;

revoke all on function public.get_publisher_profile(text) from public, anon;
grant execute on function public.get_publisher_profile(text) to authenticated;

-- Posts on a profile page. Hotlist entries never carry consultant names or
-- contact details — only role, skills, experience, visa, location and rate.
create or replace function public.get_publisher_posts(p_publisher_id uuid, p_kind text)
returns table (
  lead_id uuid,
  posted_at timestamptz,
  title text,
  locations text[],
  job_types text[],
  rate text,
  skills text[],
  summary text,
  consultant_count integer,
  visa_types text[],
  experience text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_email text;
begin
  if auth.uid() is null then return; end if;
  select pp.email into v_email from public.publisher_profiles pp where pp.id = p_publisher_id;
  if v_email is null then return; end if;

  if p_kind = 'job' then
    return query
    select j.id, coalesce(j.posted_at, j.created_at),
      coalesce(nullif(trim(j.job_title), ''), nullif(trim(j.extracted_role_normalized), ''), 'Requirement'),
      case when trim(j.location) <> '' then array[trim(j.location)] else '{}'::text[] end,
      case when trim(j.employment_type) <> '' then array[trim(j.employment_type)] else '{}'::text[] end,
      nullif(trim(j.salary_range), ''),
      coalesce((select array_agg(s) from (
        select trim(both '"' from e::text) s from jsonb_array_elements(
          case when jsonb_typeof(j.extracted_skills) = 'array' then j.extracted_skills else '[]'::jsonb end) e
        limit 8) t), '{}'::text[]),
      left(regexp_replace(coalesce(nullif(trim(j.job_description), ''), j.post_content), '\s+', ' ', 'g'), 320),
      null::integer, '{}'::text[],
      case when j.extracted_experience_years is not null then j.extracted_experience_years::text || '+ yrs' end
    from public.social_jobs j
    where j.poster_email <> ''
      and public.publisher_email_key(j.poster_email) = v_email
      and j.created_at >= now() - interval '30 days'
      and j.hidden_at is null
      and coalesce(j.post_status, 'open') = 'open'
    order by coalesce(j.posted_at, j.created_at) desc
    limit 200;
  elsif p_kind = 'hotlist' then
    return query
    select (array_agg(h.id order by h.candidate_index))[1],
      max(coalesce(h.posted_at, h.created_at)),
      case when count(distinct lower(trim(h.role_title))) = 1 then min(nullif(trim(h.role_title), ''))
           else count(*)::text || ' consultants' end,
      coalesce((select array_agg(distinct l) from public.social_hotlist h2, unnest(h2.locations) l
                where h2.source_post_id = h.source_post_id and trim(l) <> ''), '{}'::text[]),
      coalesce(array_agg(distinct trim(h.employment_type)) filter (where trim(h.employment_type) <> ''), '{}'::text[]),
      case when min(h.hourly_rate_min) is not null
           then '$' || min(h.hourly_rate_min)::integer::text
                || coalesce('–' || max(h.hourly_rate_max)::integer::text, '') || '/hr' end,
      coalesce((select array_agg(s) from (
        select s from public.social_hotlist h3, unnest(h3.core_skills) s
        where h3.source_post_id = h.source_post_id and trim(s) <> ''
        group by s order by count(*) desc, s limit 8) t), '{}'::text[]),
      array_to_string(array_agg(distinct nullif(trim(h.role_title), '')), ', '),
      count(*)::integer,
      coalesce(array_agg(distinct trim(h.visa_type)) filter (where trim(h.visa_type) <> ''), '{}'::text[]),
      case when min(h.years_experience) is not null
           then min(h.years_experience)::integer::text
                || case when max(h.years_experience) > min(h.years_experience)
                        then '–' || max(h.years_experience)::integer::text else '' end || ' yrs' end
    from public.social_hotlist h
    where h.bench_sales_recruiter_email <> ''
      and public.publisher_email_key(h.bench_sales_recruiter_email) = v_email
      and h.created_at >= now() - interval '30 days'
      and h.hidden_at is null
      and coalesce(h.post_status, 'open') = 'open'
    group by h.source_post_id
    order by max(coalesce(h.posted_at, h.created_at)) desc
    limit 200;
  end if;
end;
$$;

revoke all on function public.get_publisher_posts(uuid, text) from public, anon;
grant execute on function public.get_publisher_posts(uuid, text) to authenticated;

-- The publisher behind one post, for the Subscribe button on feed posts.
create or replace function public.get_publisher_for_lead(p_kind text, p_lead_id uuid)
returns table (publisher_id uuid, slug text, display_name text, is_following boolean, is_mine boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_email text;
begin
  if auth.uid() is null then return; end if;
  if p_kind = 'job' then
    select public.publisher_email_key(j.poster_email) into v_email from public.social_jobs j where j.id = p_lead_id;
  elsif p_kind = 'hotlist' then
    select public.publisher_email_key(h.bench_sales_recruiter_email) into v_email from public.social_hotlist h where h.id = p_lead_id;
  end if;
  if v_email is null or v_email = '' then return; end if;

  return query
  select p.id, p.slug, p.display_name,
    exists (select 1 from public.publisher_follows f where f.account_id = v_account and f.publisher_id = p.id),
    v_account is not null and p.claimed_account_id = v_account
  from public.publisher_profiles p
  where p.email = v_email;
end;
$$;

revoke all on function public.get_publisher_for_lead(text, uuid) from public, anon;
grant execute on function public.get_publisher_for_lead(text, uuid) to authenticated;
