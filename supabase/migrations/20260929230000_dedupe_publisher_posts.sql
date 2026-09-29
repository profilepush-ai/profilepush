-- Reposts counted and listed twice. The main feed collapses duplicates by
-- dedup_key (20260917180000); the publisher queries didn't, so one
-- requirement posted three times showed as three posts on the profile, in the
-- card counts, in the Active ranking and in search counts. They now use the
-- same key:
--   jobs     one post per dedup_key (title/role, company, location, platform),
--            keeping the latest
--   hotlists one post per set of consultants: the sorted dedup_key_base of its
--            rows, so the same hotlist reposted under a new source_post_id
--            counts once

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
  select jobs.* from (
    select distinct on (p.id, coalesce(nullif(j.dedup_key, ''), j.id::text))
      p.id as publisher_id,
      coalesce(nullif(j.dedup_key, ''), j.id::text) as post_key,
      j.id as lead_id,
      coalesce(j.posted_at, j.created_at) as posted_at,
      array[coalesce(nullif(trim(j.extracted_role_normalized), ''), nullif(trim(j.job_title), ''), 'Role')] as roles,
      case when trim(j.location) <> '' then array[trim(j.location)] else '{}'::text[] end as locations,
      case when trim(j.employment_type) <> '' then array[trim(j.employment_type)] else '{}'::text[] end as job_types
    from public.publisher_profiles p
    join public.social_jobs j
      on public.publisher_email_key(j.poster_email) = p.email and j.poster_email <> ''
    where p_kind = 'job'
      and p.id = any(p_publisher_ids)
      and j.created_at >= now() - make_interval(days => p_days)
      and j.hidden_at is null
      and coalesce(j.post_status, 'open') = 'open'
    order by p.id, coalesce(nullif(j.dedup_key, ''), j.id::text), coalesce(j.posted_at, j.created_at) desc
  ) jobs
  union all
  select hot.publisher_id, hot.sig, hot.lead_id, hot.posted_at, hot.roles, hot.locations, hot.job_types
  from (
    select distinct on (hp.publisher_id, hp.sig) hp.*
    from (
      select p.id as publisher_id,
        string_agg(distinct coalesce(nullif(h.dedup_key_base, ''), h.id::text), '||') as sig,
        (array_agg(h.id order by h.candidate_index))[1] as lead_id,
        max(coalesce(h.posted_at, h.created_at)) as posted_at,
        array_agg(distinct coalesce(nullif(trim(h.role_title), ''), 'Consultant')) as roles,
        coalesce((select array_agg(distinct l) from public.social_hotlist h2, unnest(h2.locations) l
                  where h2.source_post_id = h.source_post_id and trim(l) <> ''), '{}'::text[]) as locations,
        coalesce(array_agg(distinct trim(h.employment_type)) filter (where trim(h.employment_type) <> ''), '{}'::text[]) as job_types
      from public.publisher_profiles p
      join public.social_hotlist h
        on public.publisher_email_key(h.bench_sales_recruiter_email) = p.email and h.bench_sales_recruiter_email <> ''
      where p_kind = 'hotlist'
        and p.id = any(p_publisher_ids)
        and h.created_at >= now() - make_interval(days => p_days)
        and h.hidden_at is null
        and coalesce(h.post_status, 'open') = 'open'
      group by p.id, h.source_post_id
    ) hp
    order by hp.publisher_id, hp.sig, hp.posted_at desc
  ) hot
$$;

revoke all on function public.publisher_recent_posts(uuid[], text, integer) from public, anon, authenticated;

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
    select d.lead_id, d.posted_at, d.title, d.locations, d.job_types, d.rate, d.skills, d.summary,
      d.consultant_count, d.visa_types, d.experience
    from (
      select distinct on (coalesce(nullif(j.dedup_key, ''), j.id::text))
        j.id as lead_id,
        coalesce(j.posted_at, j.created_at) as posted_at,
        coalesce(nullif(trim(j.job_title), ''), nullif(trim(j.extracted_role_normalized), ''), 'Requirement') as title,
        case when trim(j.location) <> '' then array[trim(j.location)] else '{}'::text[] end as locations,
        case when trim(j.employment_type) <> '' then array[trim(j.employment_type)] else '{}'::text[] end as job_types,
        nullif(trim(j.salary_range), '') as rate,
        coalesce((select array_agg(s) from (
          select trim(both '"' from e::text) s from jsonb_array_elements(
            case when jsonb_typeof(j.extracted_skills) = 'array' then j.extracted_skills else '[]'::jsonb end) e
          limit 8) t), '{}'::text[]) as skills,
        left(regexp_replace(coalesce(nullif(trim(j.job_description), ''), j.post_content), '\s+', ' ', 'g'), 320) as summary,
        null::integer as consultant_count,
        '{}'::text[] as visa_types,
        case when j.extracted_experience_years is not null then j.extracted_experience_years::text || '+ yrs' end as experience
      from public.social_jobs j
      where j.poster_email <> ''
        and public.publisher_email_key(j.poster_email) = v_email
        and j.created_at >= now() - interval '30 days'
        and j.hidden_at is null
        and coalesce(j.post_status, 'open') = 'open'
      order by coalesce(nullif(j.dedup_key, ''), j.id::text), coalesce(j.posted_at, j.created_at) desc
    ) d
    order by d.posted_at desc
    limit 200;
  elsif p_kind = 'hotlist' then
    return query
    with per_post as (
      select h.source_post_id,
        string_agg(distinct coalesce(nullif(h.dedup_key_base, ''), h.id::text), '||') as sig,
        (array_agg(h.id order by h.candidate_index))[1] as lead_id,
        max(coalesce(h.posted_at, h.created_at)) as posted_at,
        case when count(distinct lower(trim(h.role_title))) = 1 then min(nullif(trim(h.role_title), ''))
             else count(*)::text || ' consultants' end as title,
        coalesce(array_agg(distinct trim(h.employment_type)) filter (where trim(h.employment_type) <> ''), '{}'::text[]) as job_types,
        case when min(h.hourly_rate_min) is not null
             then '$' || min(h.hourly_rate_min)::integer::text
                  || coalesce('–' || max(h.hourly_rate_max)::integer::text, '') || '/hr' end as rate,
        array_to_string(array_agg(distinct nullif(trim(h.role_title), '')), ', ') as summary,
        count(*)::integer as consultant_count,
        coalesce(array_agg(distinct trim(h.visa_type)) filter (where trim(h.visa_type) <> ''), '{}'::text[]) as visa_types,
        case when min(h.years_experience) is not null
             then min(h.years_experience)::integer::text
                  || case when max(h.years_experience) > min(h.years_experience)
                          then '–' || max(h.years_experience)::integer::text else '' end || ' yrs' end as experience
      from public.social_hotlist h
      where h.bench_sales_recruiter_email <> ''
        and public.publisher_email_key(h.bench_sales_recruiter_email) = v_email
        and h.created_at >= now() - interval '30 days'
        and h.hidden_at is null
        and coalesce(h.post_status, 'open') = 'open'
      group by h.source_post_id
    ),
    unique_posts as (
      select distinct on (pp.sig) pp.*
      from per_post pp
      order by pp.sig, pp.posted_at desc
    )
    select u.lead_id, u.posted_at, u.title,
      coalesce((select array_agg(distinct l) from public.social_hotlist h2, unnest(h2.locations) l
                where h2.source_post_id = u.source_post_id and trim(l) <> ''), '{}'::text[]),
      u.job_types, u.rate,
      coalesce((select array_agg(s) from (
        select s from public.social_hotlist h3, unnest(h3.core_skills) s
        where h3.source_post_id = u.source_post_id and trim(s) <> ''
        group by s order by count(*) desc, s limit 8) t), '{}'::text[]),
      u.summary, u.consultant_count, u.visa_types, u.experience
    from unique_posts u
    order by u.posted_at desc
    limit 200;
  end if;
end;
$$;

revoke all on function public.get_publisher_posts(uuid, text) from public, anon;
grant execute on function public.get_publisher_posts(uuid, text) to authenticated;

-- Active tab, as 20260929220000 with posts collapsed the same way.
create or replace function public.get_suggested_publishers(p_kind text, p_limit integer default 20, p_offset integer default 0)
returns table (
  publisher_id uuid,
  slug text,
  display_name text,
  company_name text,
  avatar_url text,
  is_claimed boolean,
  post_count integer,
  top_roles text[],
  total_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
  ranked as (
    select p.id, p.slug, p.display_name, p.company_name, p.avatar_url,
      p.claimed_account_id is not null as is_claimed,
      pp.n, pp.last_at,
      count(*) over ()::integer as total
    from per_poster pp
    join public.publisher_profiles p on p.email = pp.email
    where p.claimed_account_id is distinct from v_account
      and not exists (select 1 from public.publisher_follows f where f.account_id = v_account and f.publisher_id = p.id)
  )
  select r.id, r.slug, r.display_name, r.company_name, r.avatar_url, r.is_claimed,
    r.n, '{}'::text[], r.total
  from ranked r
  order by r.n desc, r.last_at desc, r.id
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.get_suggested_publishers(text, integer, integer) from public, anon;
grant execute on function public.get_suggested_publishers(text, integer, integer) to authenticated;

-- Search match counts, as 20260929130000 with posts collapsed the same way.
create or replace function public.search_publishers(p_kind text, p_query text, p_limit integer default 30)
returns table (
  publisher_id uuid,
  slug text,
  display_name text,
  company_name text,
  avatar_url text,
  is_claimed boolean,
  is_following boolean,
  is_mine boolean,
  match_count integer,
  latest_match_at timestamptz,
  top_roles text[],
  name_match boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
  order by m.name_match desc, coalesce(m.match_count, 0) desc, m.latest_match_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 30), 60));
end;
$$;

revoke all on function public.search_publishers(text, text, integer) from public, anon;
grant execute on function public.search_publishers(text, text, integer) to authenticated;
