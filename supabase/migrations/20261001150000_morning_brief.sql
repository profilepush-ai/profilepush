-- Morning brief: the daily email that replaces the generic digest with what
-- matters to each person. The profilepush-email-notifications worker reads
-- these two functions on its daily cron and renders one email per person.
--
-- get_morning_brief: one row per recipient with
--   - matches: new requirements (last 24h) that match the account's own open
--     consultants, or new consultants that match its own open requirements.
--     Same embeddings and 0.70 threshold as the "N new jobs match your
--     consultants" notification, so the numbers agree.
--   - followed: new posts from the people the account subscribes to.
--   - recently_active: visited in the last 30 days. The worker emails
--     everyone else once a week, not daily.
-- Leaves out anyone who turned the daily email off, any address that hard-
-- bounced or complained, and Android app users seen in the last 7 days (they
-- get push instead).
--
-- get_market_brief: the same for everyone: today's volume, the most-requested
-- roles this month with their average rate, and the newest posts (for people
-- with nothing of their own to match yet).

create or replace function public.get_morning_brief()
returns table (
  user_id uuid,
  account_id uuid,
  email text,
  first_name text,
  persona text,
  recently_active boolean,
  consultant_count integer,
  requirement_count integer,
  match_kind text,
  match_total integer,
  matches jsonb,
  followed_total integer,
  followed jsonb
)
language sql
stable
security definer
-- pgvector lives in the extensions schema on this project.
set search_path = public, extensions
as $$
  with recipients as (
    select distinct on (u.id)
      u.id as user_id,
      am.account_id,
      u.email::text as email,
      nullif(initcap(split_part(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ' ', 1)), '') as first_name,
      a.active_persona::text as persona,
      exists (
        select 1 from public.user_activity_daily d
        where d.user_id = u.id and d.activity_date >= current_date - 30
      ) as recently_active
    from auth.users u
    join public.account_members am on am.user_id = u.id and am.status = 'active'
    join public.accounts a on a.id = am.account_id
    where u.email is not null
      and u.email_confirmed_at is not null
      and not exists (
        select 1 from public.notification_preferences np
        where np.user_id = u.id and np.notif_type = 'daily_digest' and np.email_enabled = false
      )
      and not exists (
        select 1 from public.email_sends s
        where lower(s.to_email) = lower(u.email)
          and (s.complained_at is not null or s.bounce_type like 'Permanent%')
      )
      and not exists (
        select 1 from public.user_app_installs i
        where i.user_id = u.id and i.last_seen_at > now() - interval '7 days'
      )
    order by u.id, am.created_at asc
  ),
  accts as (select distinct r.account_id from recipients r),
  consultants as (
    select h.created_by_account_id as account_id, h.id, h.hotlist_embedding as emb
    from public.social_hotlist h
    join accts on accts.account_id = h.created_by_account_id
    where h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
  ),
  own_jobs as (
    select j.created_by_account_id as account_id, j.id, j.job_embedding as emb
    from public.social_jobs j
    join accts on accts.account_id = j.created_by_account_id
    where j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
  ),
  recent_jobs as (
    select j.id, j.job_title, j.location, j.extracted_hourly_rate_min as rate_min, j.extracted_hourly_rate_max as rate_max,
           j.job_embedding as emb, coalesce(j.posted_at, j.created_at) as at, j.created_by_account_id,
           lower(trim(split_part(coalesce(j.poster_email, ''), ',', 1))) as poster_key
    from public.social_jobs j
    where j.hidden_at is null
      and coalesce(j.posted_at, j.created_at) >= now() - interval '24 hours'
      -- Same contactability rule the feed applies.
      and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
  ),
  recent_hotlists as (
    select h.id, h.role_title, h.locations, h.visa_type, h.years_experience, h.hourly_rate_min as rate_min, h.hourly_rate_max as rate_max,
           h.hotlist_embedding as emb, coalesce(h.posted_at, h.created_at) as at, h.created_by_account_id,
           lower(trim(split_part(coalesce(h.bench_sales_recruiter_email, ''), ',', 1))) as poster_key
    from public.social_hotlist h
    where h.hidden_at is null
      and coalesce(h.posted_at, h.created_at) >= now() - interval '24 hours'
      -- Never show a consultant's name: some posts put it where the role goes.
      and coalesce(btrim(h.role_title), '') <> ''
      and h.role_title !~* '^\s*name\b'
      and (nullif(btrim(h.candidate_name), '') is null or position(lower(btrim(h.candidate_name)) in lower(h.role_title)) = 0)
  ),
  job_pairs as (
    select c.account_id, j.id, max(1 - (c.emb <=> j.emb)) as sim
    from consultants c
    cross join recent_jobs j
    where c.emb is not null and j.emb is not null and j.created_by_account_id is distinct from c.account_id
    group by 1, 2
  ),
  job_matches as (
    select p.account_id, count(*)::integer as total,
      to_jsonb((array_agg(jsonb_build_object(
        'kind', 'job', 'id', j.id, 'title', j.job_title, 'location', j.location,
        'rate_min', j.rate_min, 'rate_max', j.rate_max
      ) order by p.sim desc))[1:3]) as top
    from job_pairs p
    join recent_jobs j on j.id = p.id
    where p.sim >= 0.70
    group by p.account_id
  ),
  hotlist_pairs as (
    select o.account_id, h.id, max(1 - (o.emb <=> h.emb)) as sim
    from own_jobs o
    cross join recent_hotlists h
    where o.emb is not null and h.emb is not null and h.created_by_account_id is distinct from o.account_id
    group by 1, 2
  ),
  hotlist_matches as (
    select p.account_id, count(*)::integer as total,
      to_jsonb((array_agg(jsonb_build_object(
        'kind', 'hotlist', 'id', h.id, 'title', h.role_title, 'location', array_to_string(h.locations, ', '),
        'visa', h.visa_type, 'experience', h.years_experience, 'rate_min', h.rate_min, 'rate_max', h.rate_max
      ) order by p.sim desc))[1:3]) as top
    from hotlist_pairs p
    join recent_hotlists h on h.id = p.id
    where p.sim >= 0.70
    group by p.account_id
  ),
  follows as (
    select f.account_id, pp.email as poster_key,
           coalesce(nullif(pp.display_name, ''), nullif(pp.company_name, ''), 'Someone you subscribe to') as name
    from public.publisher_follows f
    join public.publisher_profiles pp on pp.id = f.publisher_id
    join accts on accts.account_id = f.account_id
    where not coalesce(f.muted, false)
  ),
  followed_posts as (
    select f.account_id, 'job' as kind, j.id, j.job_title as title, f.name, j.at
    from follows f join recent_jobs j on j.poster_key = f.poster_key
    union all
    select f.account_id, 'hotlist', h.id, h.role_title, f.name, h.at
    from follows f join recent_hotlists h on h.poster_key = f.poster_key
  ),
  followed as (
    select fp.account_id, count(*)::integer as total,
      to_jsonb((array_agg(jsonb_build_object('kind', fp.kind, 'id', fp.id, 'title', fp.title, 'name', fp.name) order by fp.at desc))[1:2]) as top
    from followed_posts fp
    group by fp.account_id
  )
  select
    r.user_id, r.account_id, r.email, r.first_name, r.persona, r.recently_active,
    (select count(*)::integer from consultants c where c.account_id = r.account_id) as consultant_count,
    (select count(*)::integer from own_jobs o where o.account_id = r.account_id) as requirement_count,
    case when coalesce(jm.total, 0) >= coalesce(hm.total, 0) and jm.total is not null then 'job'
         when hm.total is not null then 'hotlist' end as match_kind,
    coalesce(greatest(jm.total, hm.total), 0) as match_total,
    coalesce(case when coalesce(jm.total, 0) >= coalesce(hm.total, 0) then jm.top else hm.top end, '[]'::jsonb) as matches,
    coalesce(f.total, 0) as followed_total,
    coalesce(f.top, '[]'::jsonb) as followed
  from recipients r
  left join job_matches jm on jm.account_id = r.account_id
  left join hotlist_matches hm on hm.account_id = r.account_id
  left join followed f on f.account_id = r.account_id;
$$;

create or replace function public.get_market_brief()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with jobs as (
    select j.id, j.job_title, j.location, j.extracted_role_normalized as role,
           j.extracted_hourly_rate_min as rate_min, j.extracted_hourly_rate_max as rate_max,
           coalesce(j.posted_at, j.created_at) as at
    from public.social_jobs j
    where j.hidden_at is null
      and coalesce(j.posted_at, j.created_at) >= now() - interval '8 days'
      and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
  ),

  hot as (
    select h.id, h.role_title, h.locations, h.visa_type, h.years_experience, h.hourly_rate_min as rate_min, h.hourly_rate_max as rate_max,
           coalesce(h.posted_at, h.created_at) as at
    from public.social_hotlist h
    where h.hidden_at is null and coalesce(h.posted_at, h.created_at) >= now() - interval '24 hours'
      -- Never show a consultant's name: some posts put it where the role goes.
      and coalesce(btrim(h.role_title), '') <> ''
      and h.role_title !~* '^\s*name\b'
      and (nullif(btrim(h.candidate_name), '') is null or position(lower(btrim(h.candidate_name)) in lower(h.role_title)) = 0)
  )
  select jsonb_build_object(
    'jobs_24h', (select count(*) from jobs where at >= now() - interval '24 hours'),
    'hotlists_24h', (select count(*) from hot),
    -- Most-requested roles over 30 days (the Market Pulse directory), with
    -- requirement counts and the average rate.
    'top_roles', coalesce((
      select jsonb_agg(jsonb_build_object('role', d.target_role, 'jobs_30d', d.unique_jobs, 'avg_rate', round(d.avg_rate)) order by d.rank)
      from (select * from public.pulse_directory_30d order by rank limit 3) d
    ), '[]'::jsonb),
    'latest_jobs', coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'job', 'id', id, 'title', job_title, 'location', location, 'rate_min', rate_min, 'rate_max', rate_max) order by at desc)
      from (
        select * from jobs
        where at >= now() - interval '24 hours' and coalesce(btrim(job_title), '') <> '' and coalesce(btrim(location), '') <> ''
        order by (rate_min is not null) desc, at desc
        limit 3
      ) t
    ), '[]'::jsonb),
    'latest_hotlists', coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'hotlist', 'id', id, 'title', role_title, 'location', array_to_string(locations, ', '),
                                          'visa', visa_type, 'experience', years_experience, 'rate_min', rate_min, 'rate_max', rate_max) order by at desc)
      from (
        select * from hot
        where coalesce(btrim(role_title), '') <> ''
        order by (years_experience is not null) desc, at desc
        limit 3
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_morning_brief() from public, anon, authenticated;
revoke all on function public.get_market_brief() from public, anon, authenticated;
grant execute on function public.get_morning_brief() to service_role;
grant execute on function public.get_market_brief() to service_role;
