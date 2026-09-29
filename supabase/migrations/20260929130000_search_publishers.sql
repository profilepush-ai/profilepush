-- Search on the Vendors / Bench Recs page. One box finds publishers two ways:
-- by name or company, and by what they posted in the last 30 days (for
-- example "Salesforce Texas"), using the same search_document index and
-- websearch syntax as the main feeds. Results cover every publisher, not only
-- followed ones, so search is also how people find someone to subscribe to.
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
      j.id::text as post_key,
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
    select public.publisher_email_key(h.bench_sales_recruiter_email),
      h.source_post_id,
      coalesce(h.posted_at, h.created_at),
      coalesce(nullif(trim(h.role_title), ''), 'Consultant')
    from public.social_hotlist h
    where p_kind = 'hotlist'
      and numnode(v_tsq) > 0
      and h.search_document @@ v_tsq
      and h.bench_sales_recruiter_email <> ''
      and h.created_at >= now() - interval '30 days'
      and h.hidden_at is null
      and coalesce(h.post_status, 'open') = 'open'
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
