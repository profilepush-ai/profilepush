-- Network > Active: the most subscribed publishers first, then the most
-- posts this week. Each row also carries its subscriber count for display.
-- The return type gains follower_count, so the function is recreated.
drop function if exists public.get_suggested_publishers(text, integer, integer);

create function public.get_suggested_publishers(p_kind text, p_limit integer default 20, p_offset integer default 0)
returns table (
  publisher_id uuid,
  slug text,
  display_name text,
  company_name text,
  avatar_url text,
  is_claimed boolean,
  post_count integer,
  top_roles text[],
  total_count integer,
  follower_count integer
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
    where p.claimed_account_id is distinct from v_account
      and not exists (select 1 from public.publisher_follows f where f.account_id = v_account and f.publisher_id = p.id)
  )
  select r.id, r.slug, r.display_name, r.company_name, r.avatar_url, r.is_claimed,
    r.n, '{}'::text[], r.total, r.followers
  from ranked r
  order by r.followers desc, r.n desc, r.last_at desc, r.id
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.get_suggested_publishers(text, integer, integer) from public, anon;
grant execute on function public.get_suggested_publishers(text, integer, integer) to authenticated;
