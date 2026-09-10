-- The new cross-match pitch needs an actual post (job_id or hotlist_id) per
-- candidate to compute a match count and fetch role/skills context — the
-- prior version of this RPC only returned (email, source), which was enough
-- for a flat "N jobs/N hotlist profiles added today" stat but not enough for
-- a per-lead cross-match count. Widen it to also return one representative
-- id per email (their most recent post, across whichever source), keeping
-- the exact same anti-join dedup cursor (against market_stats_email_sends
-- and auth.users) so no candidate is skipped or re-sent across runs.
-- Postgres refuses CREATE OR REPLACE when the OUT-parameter row shape
-- changes (adding job_id/hotlist_id here) — must drop first.
drop function if exists public.get_market_stats_outreach_backfill_batch(integer);

create function public.get_market_stats_outreach_backfill_batch(p_limit integer default 25)
returns table(email text, source text, job_id uuid, hotlist_id uuid)
language sql
security definer
set search_path = public, auth
as $$
  with job_candidates as (
    select distinct on (lower(trim(sj.poster_email)))
      lower(trim(sj.poster_email)) as email,
      'job' as source,
      sj.id as job_id,
      null::uuid as hotlist_id,
      coalesce(sj.posted_at, sj.created_at) as sort_at
    from public.social_jobs sj
    where sj.poster_email is not null and trim(sj.poster_email) <> ''
    order by lower(trim(sj.poster_email)), coalesce(sj.posted_at, sj.created_at) desc
  ),
  hotlist_candidates as (
    select distinct on (lower(trim(sh.bench_sales_recruiter_email)))
      lower(trim(sh.bench_sales_recruiter_email)) as email,
      'hotlist' as source,
      null::uuid as job_id,
      sh.id as hotlist_id,
      coalesce(sh.posted_at, sh.created_at) as sort_at
    from public.social_hotlist sh
    where sh.bench_sales_recruiter_email is not null and trim(sh.bench_sales_recruiter_email) <> ''
    order by lower(trim(sh.bench_sales_recruiter_email)), coalesce(sh.posted_at, sh.created_at) desc
  ),
  candidates as (
    select * from job_candidates
    union all
    select * from hotlist_candidates
  ),
  deduped as (
    select distinct on (email) email, source, job_id, hotlist_id
    from candidates
    order by email, sort_at desc
  )
  select d.email, d.source, d.job_id, d.hotlist_id
  from deduped d
  where not exists (select 1 from public.market_stats_email_sends s where s.email = d.email)
    and not exists (select 1 from auth.users u where lower(u.email) = d.email)
  order by d.email asc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
$$;

revoke all on function public.get_market_stats_outreach_backfill_batch(integer) from public;
grant execute on function public.get_market_stats_outreach_backfill_batch(integer) to service_role;
