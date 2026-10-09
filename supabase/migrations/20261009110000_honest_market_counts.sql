/*
# Honest live counts on the public site

public_market_snapshot counted every row: reposts, India recruiter jobs,
non-US and non-IT posts. On 2026-10-09 that showed 20,062 requirements in 30
days; the distinct US IT figure is about 12,400.

- compute_market_snapshot: counts distinct requirements (by dedup_key) and
  distinct consultants (pp_consultant_key: name + role + recruiter email when
  named) that pass the same rules as the Feed (pp_job_lead_ok /
  pp_hotlist_lead_ok). The sample cards use the same filters, de-duplicated.
- It takes ~1.5s, so a cron job refreshes a one-row cache every 10 minutes and
  public_market_snapshot (same name, same shape) reads the cache (<1 ms).
*/

-- Consultant identity for counting: a named consultant reposted by the same
-- recruiter is one consultant (same rule as the Feed); unnamed rows count once each.
create or replace function public.pp_consultant_key(p_id uuid, p_name text, p_role text, p_email text)
returns text language sql immutable as $$
  select case
    when length(public.pulse_dedupe_text(coalesce(p_name, ''))) >= 3
    then 'consultant|' || public.pulse_dedupe_text(p_name) || '|' || coalesce(public.pulse_dedupe_text(p_role), '') || '|' || lower(coalesce(btrim(p_email), ''))
    else p_id::text
  end;
$$;

create or replace function public.compute_market_snapshot()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with jobs as (
    select j.dedup_key, j.created_at, j.job_title, j.location, j.employment_type, j.extracted_skills,
      j.extracted_experience_years, j.posted_at
    from public.social_jobs j
    where j.hidden_at is null
      and (j.post_source = 'user_post' or coalesce(btrim(j.poster_email), '') <> '')
      and public.pp_job_lead_ok(j.country, j.job_category, j.job_title, j.location)
  ),
  hot as (
    select public.pp_consultant_key(h.id, h.candidate_name, h.role_title, h.bench_sales_recruiter_email) as ckey,
      h.created_at, h.role_title, h.core_skills, h.years_experience, h.visa_type, h.work_type, h.locations, h.posted_at
    from public.social_hotlist h
    where h.hidden_at is null
      and public.pp_hotlist_lead_ok(h.country, h.job_category, h.role_title, h.locations)
  )
  select jsonb_build_object(
    -- Distinct US IT requirements and consultants (reposts counted once).
    'stats', (
      select jsonb_build_object(
        'jobs24h', count(distinct dedup_key) filter (where created_at > now() - interval '24 hours'),
        'jobs7d',  count(distinct dedup_key) filter (where created_at > now() - interval '7 days'),
        'jobs30d', count(distinct dedup_key) filter (where created_at > now() - interval '30 days'),
        'jobsAll', count(distinct dedup_key)
      )
      from jobs
    ) || (
      select jsonb_build_object(
        'hot24h', count(distinct ckey) filter (where created_at > now() - interval '24 hours'),
        'hot7d',  count(distinct ckey) filter (where created_at > now() - interval '7 days'),
        'hot30d', count(distinct ckey) filter (where created_at > now() - interval '30 days'),
        'hotAll', count(distinct ckey)
      )
      from hot
    ),
    'jobs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'title',  public.pp_public_scrub(j.job_title),
          'loc',    public.pp_public_scrub(j.location),
          'type',   public.pp_public_scrub(j.employment_type),
          'skills', coalesce((
            select jsonb_agg(public.pp_public_scrub(s.v) order by s.n)
            from jsonb_array_elements_text(
              case when jsonb_typeof(j.extracted_skills) = 'array' then j.extracted_skills else '[]'::jsonb end
            ) with ordinality as s(v, n)
            where s.n <= 4
          ), '[]'::jsonb),
          'exp',    j.extracted_experience_years,
          'at',     coalesce(j.posted_at, j.created_at)
        )
        order by j.created_at desc
      )
      from (
        select * from (
          select distinct on (dedup_key) *
          from (
            select * from jobs
            where job_title is not null and btrim(job_title) <> ''
              and created_at > now() - interval '3 days'
            order by created_at desc
            limit 200
          ) recent
          order by dedup_key, created_at desc
        ) d
        order by created_at desc
        limit 40
      ) j
    ), '[]'::jsonb),
    'hotlist', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'title',  public.pp_public_scrub(h.role_title),
          'skills', coalesce((
            select jsonb_agg(public.pp_public_scrub(s.v) order by s.n)
            from unnest(h.core_skills) with ordinality as s(v, n)
            where s.n <= 4
          ), '[]'::jsonb),
          'exp',    case when h.years_experience is not null then round(h.years_experience)::int end,
          'visa',   public.pp_public_scrub(h.visa_type),
          'work',   public.pp_public_scrub(h.work_type),
          'loc',    public.pp_public_scrub(h.locations[1]),
          'at',     coalesce(h.posted_at, h.created_at)
        )
        order by h.created_at desc
      )
      from (
        select * from (
          select distinct on (ckey) *
          from (
            select * from hot
            where role_title is not null and btrim(role_title) <> ''
              and created_at > now() - interval '3 days'
            order by created_at desc
            limit 200
          ) recent
          order by ckey, created_at desc
        ) d
        order by created_at desc
        limit 40
      ) h
    ), '[]'::jsonb),
    'asOf', to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD')
  );
$function$;

revoke all on function public.compute_market_snapshot() from public, anon, authenticated;

-- The honest counts take about 1.5s, so they are computed every 10 minutes
-- into a one-row cache that the public RPC reads.
create table if not exists public.market_snapshot_cache (
  id integer primary key default 1 check (id = 1),
  data jsonb not null,
  refreshed_at timestamptz not null default now()
);
alter table public.market_snapshot_cache enable row level security;

create or replace function public.refresh_market_snapshot()
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  insert into public.market_snapshot_cache (id, data, refreshed_at)
  values (1, public.compute_market_snapshot(), now())
  on conflict (id) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
$function$;
revoke all on function public.refresh_market_snapshot() from public, anon, authenticated;

create or replace function public.public_market_snapshot()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select c.data from public.market_snapshot_cache c where c.id = 1),
    public.compute_market_snapshot()
  );
$function$;
grant execute on function public.public_market_snapshot() to anon, authenticated;

select public.refresh_market_snapshot();

do $cron$
begin
  perform cron.unschedule('refresh-market-snapshot')
  where exists (select 1 from cron.job where jobname = 'refresh-market-snapshot');
  perform cron.schedule('refresh-market-snapshot', '*/10 * * * *', 'select public.refresh_market_snapshot();');
end;
$cron$;
