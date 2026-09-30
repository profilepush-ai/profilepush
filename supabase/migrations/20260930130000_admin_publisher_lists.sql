-- Admin > Lists: vendor and bench sales contact lists for bulk email (GMass).
-- Service role only; the admin-lists function calls it after checking the
-- admin password. One JSON value rather than rows, so PostgREST's 1,000-row
-- cap can't cut a list short.
--
-- Posts are counted the deduped way (dedup_key for jobs, source_post_id for
-- hotlists). Anyone who unsubscribed — from subscriber emails
-- (publisher_profiles.email_opted_out) or from earlier outreach
-- (market_stats_email_sends.unsubscribed) — is never included.
create or replace function public.admin_publisher_list(
  p_kind text,
  p_days integer default null,
  p_unjoined_only boolean default true
)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  with rows as (
    select public.publisher_email_key(j.poster_email) as email, trim(j.posted_by_name) as name,
      trim(j.poster_phone) as phone, trim(j.company_name) as company,
      coalesce(nullif(j.dedup_key, ''), j.id::text) as post_key,
      coalesce(j.posted_at, j.created_at) as at, j.created_at
    from public.social_jobs j
    where p_kind = 'vendors' and j.poster_email <> '' and j.hidden_at is null
      and (p_days is null or j.created_at >= now() - make_interval(days => p_days))
    union all
    select public.publisher_email_key(h.bench_sales_recruiter_email), trim(h.bench_sales_recruiter_name),
      trim(h.bench_sales_recruiter_phone), trim(h.bench_sales_company_name),
      h.source_post_id, coalesce(h.posted_at, h.created_at), h.created_at
    from public.social_hotlist h
    where p_kind = 'bench-sales' and h.bench_sales_recruiter_email <> '' and h.hidden_at is null
      and (p_days is null or h.created_at >= now() - make_interval(days => p_days))
  ),
  people as (
    select r.email,
      (array_agg(r.name order by r.created_at desc) filter (where r.name <> ''))[1] as name,
      (array_agg(r.phone order by r.created_at desc) filter (where r.phone <> ''))[1] as phone,
      (array_agg(r.company order by r.created_at desc) filter (where r.company <> ''))[1] as company,
      count(distinct r.post_key)::integer as posts,
      max(r.at) as last_posted
    from rows r
    where position('@' in r.email) > 0
    group by r.email
  ),
  flagged as (
    select pe.*,
      (exists (select 1 from auth.users u where lower(trim(u.email)) = pe.email)
        or exists (select 1 from public.publisher_profiles p where p.email = pe.email and p.claimed_account_id is not null)) as joined
    from people pe
    where not exists (select 1 from public.publisher_profiles p where p.email = pe.email and p.email_opted_out)
      and not exists (select 1 from public.market_stats_email_sends m where lower(trim(m.email)) = pe.email and m.unsubscribed)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'email', f.email,
      'name', coalesce(f.name, ''),
      'phone', coalesce(f.phone, ''),
      'company', coalesce(f.company, ''),
      'posts', f.posts,
      'last_posted', to_char(f.last_posted, 'YYYY-MM-DD'),
      'joined', f.joined
    ) order by f.posts desc, f.last_posted desc), '[]'::jsonb)
  from flagged f
  where p_kind in ('vendors', 'bench-sales')
    and (not p_unjoined_only or not f.joined)
$$;

revoke all on function public.admin_publisher_list(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.admin_publisher_list(text, integer, boolean) to service_role;
