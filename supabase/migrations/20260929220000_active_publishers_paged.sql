-- The Active tab: every publisher with an open post in the last 7 days, most
-- posts first, paged by offset. The previous version returned at most 300, so
-- the tab's count stopped at 300 however many were active. Each row now
-- carries total_count, the real number, for the tab.
--
-- One pass over the week's posts, grouped by poster, rather than counting per
-- candidate: cheaper, and the ranking and the count come from the same rows.

drop function if exists public.get_suggested_publishers(text, integer);

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
    select public.publisher_email_key(j.poster_email) as email, j.id::text as post_key,
      coalesce(j.posted_at, j.created_at) as at
    from public.social_jobs j
    where p_kind = 'job'
      and j.poster_email <> ''
      and j.created_at >= now() - interval '7 days'
      and j.hidden_at is null
      and coalesce(j.post_status, 'open') = 'open'
    union all
    select public.publisher_email_key(h.bench_sales_recruiter_email), h.source_post_id,
      coalesce(h.posted_at, h.created_at)
    from public.social_hotlist h
    where p_kind = 'hotlist'
      and h.bench_sales_recruiter_email <> ''
      and h.created_at >= now() - interval '7 days'
      and h.hidden_at is null
      and coalesce(h.post_status, 'open') = 'open'
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
