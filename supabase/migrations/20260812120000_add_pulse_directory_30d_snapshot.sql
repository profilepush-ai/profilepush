-- Precomputed 30-day Pulse directory metrics. The frontend reads the view; this
-- snapshot is rebuilt periodically or through the guarded refresh RPC.

create table if not exists public.pulse_directory_30d_snapshot (
  role_key text primary key,
  target_role text not null,
  summary text not null default '',
  active_watchers bigint not null default 0,
  avatar_url text,
  min_years_exp numeric,
  max_years_exp numeric,
  visa_status text,
  employment_type text,
  work_type text,
  preferred_locations text,
  min_rate_usd_per_hr numeric,
  max_rate_usd_per_hr numeric,
  priority_skills text,
  relocation_open boolean,
  unique_hotlists bigint not null default 0,
  unique_jobs bigint not null default 0,
  unique_vendors bigint not null default 0,
  avg_rate numeric,
  refreshed_at timestamptz not null default now()
);

alter table public.pulse_directory_30d_snapshot enable row level security;
grant select on public.pulse_directory_30d_snapshot to authenticated, service_role;

drop policy if exists authenticated_read_pulse_directory_30d_snapshot
  on public.pulse_directory_30d_snapshot;
create policy authenticated_read_pulse_directory_30d_snapshot
  on public.pulse_directory_30d_snapshot
  for select to authenticated
  using (true);

create or replace view public.pulse_directory_30d
with (security_invoker = true)
as
select
  target_role,
  summary,
  active_watchers,
  avatar_url,
  row_number() over (order by unique_jobs desc, target_role asc)::integer as rank,
  min_years_exp,
  max_years_exp,
  visa_status,
  employment_type,
  work_type,
  preferred_locations,
  min_rate_usd_per_hr,
  max_rate_usd_per_hr,
  priority_skills,
  relocation_open,
  unique_hotlists,
  unique_jobs,
  unique_vendors,
  avg_rate,
  refreshed_at
from public.pulse_directory_30d_snapshot;

grant select on public.pulse_directory_30d to authenticated, service_role;

create or replace function public.refresh_pulse_directory_30d_snapshot(
  p_force boolean default false
)
returns timestamptz
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_refreshed_at timestamptz := now();
  v_existing_refresh timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('pulse_directory_30d_snapshot')) then
    select max(refreshed_at) into v_existing_refresh
    from public.pulse_directory_30d_snapshot;
    return coalesce(v_existing_refresh, v_refreshed_at);
  end if;

  select max(refreshed_at) into v_existing_refresh
  from public.pulse_directory_30d_snapshot;

  if not p_force
    and v_existing_refresh is not null
    and v_existing_refresh > now() - interval '6 hours' then
    return v_existing_refresh;
  end if;

  if p_force
    and v_existing_refresh is not null
    and v_existing_refresh > now() - interval '5 minutes' then
    return v_existing_refresh;
  end if;

  with latest_roles as (
    select distinct on (lower(regexp_replace(trim(r.target_role), '\s+', ' ', 'g')))
      lower(regexp_replace(trim(r.target_role), '\s+', ' ', 'g')) as role_key,
      trim(r.target_role) as target_role,
      coalesce(r.avatar_url, '') as avatar_url,
      r.min_years_exp,
      r.max_years_exp,
      r.visa_status,
      r.employment_type,
      r.work_type,
      r.preferred_locations,
      r.min_rate_usd_per_hr,
      r.max_rate_usd_per_hr,
      r.priority_skills,
      r.relocation_open,
      r.role_embedding
    from public.hotlist_ai_roles r
    where trim(coalesce(r.target_role, '')) <> ''
    order by
      lower(regexp_replace(trim(r.target_role), '\s+', ' ', 'g')),
      r.updated_at desc nulls last,
      r.created_at desc
  ),
  watcher_counts as (
    select
      lower(regexp_replace(trim(r.target_role), '\s+', ' ', 'g')) as role_key,
      count(*) filter (
        where r.is_active = true
          and coalesce(r.schedule_frequency, 'daily') <> 'disabled'
      )::bigint as active_watchers
    from public.hotlist_ai_roles r
    group by lower(regexp_replace(trim(r.target_role), '\s+', ' ', 'g'))
  ),
  matched_jobs as (
    select distinct
      r.role_key,
      sj.id as job_id,
      coalesce(
        nullif(trim(sj.poster_email), ''),
        nullif(trim(sj.poster_phone), ''),
        nullif(lower(trim(sj.posted_by_name)), '')
      ) as vendor_key,
      case
        when rm.hourly_rate_min > 0 and rm.hourly_rate_max > 0
          then (rm.hourly_rate_min + rm.hourly_rate_max) / 2.0
        when rm.hourly_rate_min > 0 then rm.hourly_rate_min
        when rm.hourly_rate_max > 0 then rm.hourly_rate_max
        when sj.extracted_hourly_rate_min > 0 and sj.extracted_hourly_rate_max > 0
          then (sj.extracted_hourly_rate_min + sj.extracted_hourly_rate_max) / 2.0
        when sj.extracted_hourly_rate_min > 0 then sj.extracted_hourly_rate_min
        when sj.extracted_hourly_rate_max > 0 then sj.extracted_hourly_rate_max
        else null
      end as rate
    from latest_roles r
    join public.social_jobs sj
      on r.role_embedding is not null
      and sj.job_embedding is not null
      and (1 - (r.role_embedding <=> sj.job_embedding)) >= 0.65
    join public.radar_match_results rm
      on rm.job_id = sj.id
      and rm.job_source = 'social'
    where coalesce(sj.posted_at, sj.created_at) >= now() - interval '30 days'
  ),
  job_stats as (
    select
      role_key,
      count(distinct job_id)::bigint as unique_jobs,
      count(distinct vendor_key) filter (where vendor_key is not null)::bigint as unique_vendors,
      avg(rate) filter (where rate is not null) as avg_job_rate
    from matched_jobs
    group by role_key
  ),
  matched_hotlists as (
    select distinct
      r.role_key,
      hm.hotlist_id,
      case
        when hm.hourly_rate_min > 0 and hm.hourly_rate_max > 0
          then (hm.hourly_rate_min + hm.hourly_rate_max) / 2.0
        when hm.hourly_rate_min > 0 then hm.hourly_rate_min
        when hm.hourly_rate_max > 0 then hm.hourly_rate_max
        else null
      end as rate
    from latest_roles r
    join public.radar_match_hotlist hm
      on (
        lower(trim(hm.role_title)) = r.role_key
        or lower(trim(hm.role_title)) like '%' || r.role_key || '%'
        or r.role_key like '%' || lower(trim(hm.role_title)) || '%'
      )
    join public.social_hotlist sh on sh.id = hm.hotlist_id
    where coalesce(sh.posted_at, sh.created_at) >= now() - interval '30 days'
  ),
  hotlist_stats as (
    select
      role_key,
      count(distinct hotlist_id)::bigint as unique_hotlists,
      avg(rate) filter (where rate is not null) as avg_hotlist_rate
    from matched_hotlists
    group by role_key
  ),
  snapshot_rows as (
    select
      r.role_key,
      r.target_role,
      ''::text as summary,
      coalesce(w.active_watchers, 0) as active_watchers,
      nullif(r.avatar_url, '') as avatar_url,
      r.min_years_exp,
      r.max_years_exp,
      r.visa_status,
      r.employment_type,
      r.work_type,
      r.preferred_locations,
      r.min_rate_usd_per_hr,
      r.max_rate_usd_per_hr,
      r.priority_skills,
      r.relocation_open,
      coalesce(h.unique_hotlists, 0) as unique_hotlists,
      coalesce(j.unique_jobs, 0) as unique_jobs,
      coalesce(j.unique_vendors, 0) as unique_vendors,
      case
        when h.avg_hotlist_rate is not null and j.avg_job_rate is not null
          then (h.avg_hotlist_rate + j.avg_job_rate) / 2.0
        else coalesce(h.avg_hotlist_rate, j.avg_job_rate)
      end as avg_rate
    from latest_roles r
    left join watcher_counts w using (role_key)
    left join job_stats j using (role_key)
    left join hotlist_stats h using (role_key)
  )
  insert into public.pulse_directory_30d_snapshot (
    role_key,
    target_role,
    summary,
    active_watchers,
    avatar_url,
    min_years_exp,
    max_years_exp,
    visa_status,
    employment_type,
    work_type,
    preferred_locations,
    min_rate_usd_per_hr,
    max_rate_usd_per_hr,
    priority_skills,
    relocation_open,
    unique_hotlists,
    unique_jobs,
    unique_vendors,
    avg_rate,
    refreshed_at
  )
  select
    role_key,
    target_role,
    summary,
    active_watchers,
    avatar_url,
    min_years_exp,
    max_years_exp,
    visa_status,
    employment_type,
    work_type,
    preferred_locations,
    min_rate_usd_per_hr,
    max_rate_usd_per_hr,
    priority_skills,
    relocation_open,
    unique_hotlists,
    unique_jobs,
    unique_vendors,
    avg_rate,
    v_refreshed_at
  from snapshot_rows
  on conflict (role_key) do update set
    target_role = excluded.target_role,
    summary = excluded.summary,
    active_watchers = excluded.active_watchers,
    avatar_url = excluded.avatar_url,
    min_years_exp = excluded.min_years_exp,
    max_years_exp = excluded.max_years_exp,
    visa_status = excluded.visa_status,
    employment_type = excluded.employment_type,
    work_type = excluded.work_type,
    preferred_locations = excluded.preferred_locations,
    min_rate_usd_per_hr = excluded.min_rate_usd_per_hr,
    max_rate_usd_per_hr = excluded.max_rate_usd_per_hr,
    priority_skills = excluded.priority_skills,
    relocation_open = excluded.relocation_open,
    unique_hotlists = excluded.unique_hotlists,
    unique_jobs = excluded.unique_jobs,
    unique_vendors = excluded.unique_vendors,
    avg_rate = excluded.avg_rate,
    refreshed_at = excluded.refreshed_at;

  delete from public.pulse_directory_30d_snapshot s
  where s.refreshed_at < v_refreshed_at;

  return v_refreshed_at;
end;
$$;

revoke all on function public.refresh_pulse_directory_30d_snapshot(boolean) from public;
grant execute on function public.refresh_pulse_directory_30d_snapshot(boolean)
  to authenticated, service_role;

select public.refresh_pulse_directory_30d_snapshot(true);

do $$
begin
  perform cron.unschedule('refresh-pulse-directory-30d');
exception
  when others then null;
end $$;

select cron.schedule(
  'refresh-pulse-directory-30d',
  '17 */6 * * *',
  $cron$select public.refresh_pulse_directory_30d_snapshot(false);$cron$
);
