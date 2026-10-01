-- Public publisher profiles, one-tap claim and "Remove my profile".
--
-- /profile/<slug> is readable without signing in (get_public_publisher_profile,
-- granted to anon): name, company, subscriber count and the last 30 days of
-- posts. Never an email, phone or consultant name: some hotlist posts put the
-- consultant's name where the role goes, so those roles are dropped.
--
-- Outreach emails carry a single-use claim token (profile_claim_tokens, valid
-- 14 days). The claim-profile function checks it, signs the person in with a
-- magic link for that address, and the existing claim-on-sign-in makes the
-- profile theirs.
--
-- Removing a profile sets removed_at (the row stays, so new posts can't
-- recreate it) and opts the address out of every email to unclaimed
-- publishers. Removed profiles disappear from the public page, the in-app
-- profile, Active and search.

alter table public.publisher_profiles add column if not exists removed_at timestamptz;

create table if not exists public.profile_claim_tokens (
  id uuid primary key default gen_random_uuid(),
  publisher_id uuid not null references public.publisher_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz
);

create index if not exists profile_claim_tokens_publisher_idx on public.profile_claim_tokens (publisher_id);
alter table public.profile_claim_tokens enable row level security;
revoke all on public.profile_claim_tokens from public, anon, authenticated;
grant select, insert, update on public.profile_claim_tokens to service_role;

-- For outreach senders: a fresh claim token for a publisher, or null if the
-- profile is already claimed or was removed.
create or replace function public.create_profile_claim_token(p_publisher_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.profile_claim_tokens (publisher_id)
  select p.id from public.publisher_profiles p
  where p.id = p_publisher_id and p.claimed_account_id is null and p.removed_at is null
  returning id;
$$;

-- For claim-profile: uses a token once. Returns the address and profile to
-- sign in to, with ok = false and a reason when the token can't be used.
create or replace function public.use_profile_claim_token(p_token uuid)
returns table (ok boolean, reason text, email text, slug text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_token public.profile_claim_tokens%rowtype;
  v_profile public.publisher_profiles%rowtype;
begin
  select * into v_token from public.profile_claim_tokens t where t.id = p_token for update;
  if not found then return query select false, 'not_found', null::text, null::text; return; end if;
  select * into v_profile from public.publisher_profiles p where p.id = v_token.publisher_id;
  if v_profile.removed_at is not null then return query select false, 'removed', v_profile.email, v_profile.slug; return; end if;
  if v_token.used_at is not null then return query select false, 'used', v_profile.email, v_profile.slug; return; end if;
  if v_token.expires_at < now() then return query select false, 'expired', v_profile.email, v_profile.slug; return; end if;
  update public.profile_claim_tokens t set used_at = now() where t.id = p_token;
  return query select true, null::text, v_profile.email, v_profile.slug;
end;
$$;

-- For the remove link in outreach emails (signed by the email worker).
create or replace function public.remove_publisher_profile(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.publisher_profiles
  set removed_at = coalesce(removed_at, now()),
      email_opted_out = true,
      email_opted_out_at = coalesce(email_opted_out_at, now())
  where email = public.publisher_email_key(p_email)
  returning true;
$$;

revoke all on function public.create_profile_claim_token(uuid) from public, anon, authenticated;
revoke all on function public.use_profile_claim_token(uuid) from public, anon, authenticated;
revoke all on function public.remove_publisher_profile(text) from public, anon, authenticated;
grant execute on function public.create_profile_claim_token(uuid) to service_role;
grant execute on function public.use_profile_claim_token(uuid) to service_role;
grant execute on function public.remove_publisher_profile(text) to service_role;

-- The public page. Null when there's no such profile or it was removed.
create or replace function public.get_public_publisher_profile(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select * from public.publisher_profiles where slug = p_slug and removed_at is null
  ),
  jobs as (
    select r.lead_id, r.posted_at, j.job_title, j.location, j.employment_type,
           j.extracted_hourly_rate_min as rate_min, j.extracted_hourly_rate_max as rate_max
    from p, public.publisher_recent_posts(array[p.id], 'job', 30) r
    join public.social_jobs j on j.id = r.lead_id
  ),
  hot as (
    select r.lead_id, r.posted_at, r.locations, r.job_types,
      array(
        select x from unnest(r.roles) x
        where x !~* '^\s*name\b' and lower(btrim(x)) <> 'consultant'
          and not exists (
            select 1 from public.social_hotlist h2
            where h2.source_post_id = (select h.source_post_id from public.social_hotlist h where h.id = r.lead_id)
              and nullif(btrim(h2.candidate_name), '') is not null
              and position(lower(btrim(h2.candidate_name)) in lower(x)) > 0
          )
      ) as roles
    from p, public.publisher_recent_posts(array[p.id], 'hotlist', 30) r
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'slug', (select slug from p),
    'display_name', (select display_name from p),
    'company_name', (select company_name from p),
    'avatar_url', (select avatar_url from p),
    'is_claimed', (select claimed_account_id is not null from p),
    'follower_count', (select count(*) from public.publisher_follows f, p where f.publisher_id = p.id),
    'job_count', (select count(*) from jobs),
    'hotlist_count', (select count(*) from hot),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object('id', lead_id, 'title', job_title, 'location', location, 'employment_type', employment_type,
                                          'rate_min', rate_min, 'rate_max', rate_max, 'posted_at', posted_at) order by posted_at desc)
      from (select * from jobs order by posted_at desc limit 20) t
    ), '[]'::jsonb),
    'hotlists', coalesce((
      select jsonb_agg(jsonb_build_object('id', lead_id, 'roles', to_jsonb(roles[1:6]), 'consultant_count', nullif(cardinality(roles), 0),
                                          'locations', to_jsonb(locations[1:3]), 'posted_at', posted_at) order by posted_at desc)
      from (select * from hot order by posted_at desc limit 20) t
    ), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.get_public_publisher_profile(text) from public;
grant execute on function public.get_public_publisher_profile(text) to anon, authenticated;

-- Slugs for the sitemap: profiles that posted in the last 30 days.
create or replace function public.get_public_profile_index()
returns table (slug text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.slug, greatest(p.last_job_post_at, p.last_hotlist_post_at)
  from public.publisher_profiles p
  where p.removed_at is null
    and greatest(p.last_job_post_at, p.last_hotlist_post_at) >= now() - interval '30 days'
  order by 2 desc
  limit 5000;
$$;

revoke all on function public.get_public_profile_index() from public;
grant execute on function public.get_public_profile_index() to anon, authenticated;

-- Removed profiles leave the in-app profile, Active and search.

CREATE OR REPLACE FUNCTION public.get_publisher_profile(p_slug text)
 RETURNS TABLE(publisher_id uuid, slug text, display_name text, company_name text, avatar_url text, linkedin_url text, is_claimed boolean, is_mine boolean, is_following boolean, muted boolean, last_seen_at timestamp with time zone, follower_count integer, job_post_count integer, hotlist_post_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_profile public.publisher_profiles%rowtype;
begin
  select * into v_profile from public.publisher_profiles pp where pp.slug = p_slug and pp.removed_at is null;
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
$function$;

CREATE OR REPLACE FUNCTION public.get_suggested_publishers(p_kind text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(publisher_id uuid, slug text, display_name text, company_name text, avatar_url text, is_claimed boolean, post_count integer, top_roles text[], total_count integer, follower_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
begin
  if v_account is null or p_kind not in ('job', 'hotlist') then return; end if;

  return query
  with week_posts as (
    select public.publisher_email_key(j.poster_email) as email,
      coalesce(nullif(j.dedup_key, ''), j.id::text) as post_key,
      coalesce(j.posted_at, j.created_at) as at
    from public.social_jobs j
    where p_kind = 'job'
      and j.poster_email <> ''
      and j.created_at >= now() - interval '7 days'
      and j.hidden_at is null
      and coalesce(j.post_status, 'open') = 'open'
    union all
    select hp.email, hp.sig, hp.at
    from (
      select public.publisher_email_key(h.bench_sales_recruiter_email) as email,
        string_agg(distinct coalesce(nullif(h.dedup_key_base, ''), h.id::text), '||') as sig,
        max(coalesce(h.posted_at, h.created_at)) as at
      from public.social_hotlist h
      where p_kind = 'hotlist'
        and h.bench_sales_recruiter_email <> ''
        and h.created_at >= now() - interval '7 days'
        and h.hidden_at is null
        and coalesce(h.post_status, 'open') = 'open'
      group by 1, h.source_post_id
    ) hp
  ),
  per_poster as (
    select wp.email, count(distinct wp.post_key)::integer as n, max(wp.at) as last_at
    from week_posts wp
    group by wp.email
  ),
  followers as (
    select f.publisher_id, count(*)::integer as n
    from public.publisher_follows f
    group by f.publisher_id
  ),
  ranked as (
    select p.id, p.slug, p.display_name, p.company_name, p.avatar_url,
      p.claimed_account_id is not null as is_claimed,
      pp.n, pp.last_at, coalesce(fl.n, 0) as followers,
      count(*) over ()::integer as total
    from per_poster pp
    join public.publisher_profiles p on p.email = pp.email
    left join followers fl on fl.publisher_id = p.id
    where p.removed_at is null
      and p.claimed_account_id is distinct from v_account
      and not exists (select 1 from public.publisher_follows f where f.account_id = v_account and f.publisher_id = p.id)
  )
  select r.id, r.slug, r.display_name, r.company_name, r.avatar_url, r.is_claimed,
    r.n, '{}'::text[], r.total, r.followers
  from ranked r
  order by r.followers desc, r.n desc, r.last_at desc, r.id
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_publishers(p_kind text, p_query text, p_limit integer DEFAULT 30)
 RETURNS TABLE(publisher_id uuid, slug text, display_name text, company_name text, avatar_url text, is_claimed boolean, is_following boolean, is_mine boolean, match_count integer, latest_match_at timestamp with time zone, top_roles text[], name_match boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_query text := btrim(coalesce(p_query, ''));
  v_tsq tsquery;
  v_like text;
begin
  if auth.uid() is null or p_kind not in ('job', 'hotlist') or length(v_query) < 2 then return; end if;
  v_tsq := websearch_to_tsquery('english', v_query);
  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with post_hits as (
    select public.publisher_email_key(j.poster_email) as email,
      coalesce(nullif(j.dedup_key, ''), j.id::text) as post_key,
      coalesce(j.posted_at, j.created_at) as at,
      coalesce(nullif(trim(j.extracted_role_normalized), ''), nullif(trim(j.job_title), ''), 'Role') as role
    from public.social_jobs j
    where p_kind = 'job'
      and numnode(v_tsq) > 0
      and j.search_document @@ v_tsq
      and j.poster_email <> ''
      and j.created_at >= now() - interval '30 days'
      and j.hidden_at is null
      and coalesce(j.post_status, 'open') = 'open'
    union all
    select hp.email, hp.sig, hp.at, hp.role
    from (
      select public.publisher_email_key(h.bench_sales_recruiter_email) as email,
        string_agg(distinct coalesce(nullif(h.dedup_key_base, ''), h.id::text), '||') as sig,
        max(coalesce(h.posted_at, h.created_at)) as at,
        min(coalesce(nullif(trim(h.role_title), ''), 'Consultant')) as role
      from public.social_hotlist h
      where p_kind = 'hotlist'
        and numnode(v_tsq) > 0
        and h.search_document @@ v_tsq
        and h.bench_sales_recruiter_email <> ''
        and h.created_at >= now() - interval '30 days'
        and h.hidden_at is null
        and coalesce(h.post_status, 'open') = 'open'
      group by 1, h.source_post_id
    ) hp
  ),
  post_agg as (
    select ph.email,
      count(distinct ph.post_key)::integer as match_count,
      max(ph.at) as latest_match_at
    from post_hits ph
    group by ph.email
  ),
  name_hits as (
    select p.id
    from public.publisher_profiles p
    where (p.display_name ilike v_like or p.company_name ilike v_like)
      and (case when p_kind = 'job' then p.last_job_post_at else p.last_hotlist_post_at end) >= now() - interval '30 days'
    limit 200
  ),
  candidates as (
    select p.id, pa.match_count, pa.latest_match_at, false as name_match
    from post_agg pa join public.publisher_profiles p on p.email = pa.email
    union all
    select nh.id, null::integer, null::timestamptz, true from name_hits nh
  ),
  merged as (
    select c.id,
      max(c.match_count) as match_count,
      max(c.latest_match_at) as latest_match_at,
      bool_or(c.name_match) as name_match
    from candidates c
    group by c.id
  )
  select p.id, p.slug, p.display_name, p.company_name, p.avatar_url,
    p.claimed_account_id is not null,
    exists (select 1 from public.publisher_follows f where f.account_id = v_account and f.publisher_id = p.id),
    v_account is not null and p.claimed_account_id = v_account,
    coalesce(m.match_count, 0),
    coalesce(m.latest_match_at, case when p_kind = 'job' then p.last_job_post_at else p.last_hotlist_post_at end),
    coalesce((select array_agg(r) from (
      select ph.role r from post_hits ph where ph.email = p.email
      group by ph.role order by count(*) desc, ph.role limit 3) t), '{}'::text[]),
    m.name_match
  from merged m
  join public.publisher_profiles p on p.id = m.id
  where p.removed_at is null
  order by m.name_match desc, coalesce(m.match_count, 0) desc, m.latest_match_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 30), 60));
end;
$function$;

-- The public hotlist page (/hotlist/<id>) is readable without signing in, so
-- it must never show who the consultant is: no name, the name taken out of
-- the role and summary (some posts put it there), and no link to the original
-- post (which carries the name and contact details).
create or replace function public.get_public_hotlist_lead(p_id uuid)
returns table(id uuid, candidate_name text, role_title text, core_skills text[], years_experience numeric, visa_type text,
  employment_type text, work_type text, locations text[], hourly_rate_min numeric, hourly_rate_max numeric, availability text,
  candidate_summary text, bench_sales_company_name text, bench_sales_recruiter_avatar_url text, post_source text, post_status text,
  post_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with h as (
    select sh.*,
      nullif(btrim(sh.candidate_name), '') as cname,
      -- The name with regex characters escaped, for removing it from text.
      regexp_replace(coalesce(nullif(btrim(sh.candidate_name), ''), '§no-name§'), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') as cname_re
    from public.social_hotlist sh
    where sh.id = p_id and sh.hidden_at is null
  )
  select
    h.id,
    ''::text,
    case
      when h.role_title ~* '^\s*name\b' then 'Available Consultant'
      when h.cname is not null and position(lower(h.cname) in lower(coalesce(h.role_title, ''))) > 0 then 'Available Consultant'
      else h.role_title
    end,
    h.core_skills, h.years_experience, h.visa_type, h.employment_type, h.work_type, h.locations,
    h.hourly_rate_min, h.hourly_rate_max, h.availability,
    case when h.cname is null then h.candidate_summary
         else regexp_replace(coalesce(h.candidate_summary, ''), h.cname_re, 'The consultant', 'gi') end,
    h.bench_sales_company_name, h.bench_sales_recruiter_avatar_url, h.post_source, h.post_status,
    ''::text,
    h.created_at
  from h;
$$;

revoke all on function public.get_public_hotlist_lead(uuid) from public;
grant execute on function public.get_public_hotlist_lead(uuid) to anon, authenticated;
