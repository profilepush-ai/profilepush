alter function public.refresh_pulse_directory_30d_snapshot(boolean)
  rename to refresh_pulse_directory_30d_snapshot_base;

revoke all on function public.refresh_pulse_directory_30d_snapshot_base(boolean) from public, anon, authenticated;
grant execute on function public.refresh_pulse_directory_30d_snapshot_base(boolean) to service_role;

create or replace function public.refresh_pulse_directory_30d_snapshot(
  p_force boolean default false
)
returns timestamptz
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_refreshed_at timestamptz;
begin
  v_refreshed_at := public.refresh_pulse_directory_30d_snapshot_base(p_force);

  with latest_roles as (
    select distinct on (lower(regexp_replace(trim(r.target_role), '\s+', ' ', 'g')))
      lower(regexp_replace(trim(r.target_role), '\s+', ' ', 'g')) as role_key,
      r.role_embedding
    from public.hotlist_ai_roles r
    where trim(coalesce(r.target_role, '')) <> ''
    order by
      lower(regexp_replace(trim(r.target_role), '\s+', ' ', 'g')),
      r.updated_at desc nulls last,
      r.created_at desc
  ),
  job_rate_sources as (
    select distinct
      r.role_key,
      sj.id as source_id,
      coalesce(
        nullif(rm.hourly_rate_min, 0),
        nullif(sj.extracted_hourly_rate_min, 0)
      ) as min_rate,
      coalesce(
        nullif(rm.hourly_rate_max, 0),
        nullif(sj.extracted_hourly_rate_max, 0)
      ) as max_rate
    from latest_roles r
    join public.social_jobs sj
      on (
        (
          r.role_embedding is not null
          and sj.job_embedding is not null
          and (1 - (r.role_embedding <=> sj.job_embedding)) >= 0.65
        )
        or lower(trim(coalesce(sj.extracted_role_normalized, sj.job_title, ''))) = r.role_key
        or lower(trim(coalesce(sj.extracted_role_normalized, sj.job_title, ''))) like '%' || r.role_key || '%'
        or r.role_key like '%' || lower(trim(coalesce(sj.extracted_role_normalized, sj.job_title, ''))) || '%'
      )
      and coalesce(sj.posted_at, sj.created_at) >= now() - interval '30 days'
    left join lateral (
      select
        match.hourly_rate_min,
        match.hourly_rate_max
      from public.radar_match_results match
      where match.job_id = sj.id
        and match.job_source = 'social'
      order by match.created_at desc
      limit 1
    ) rm on true
  ),
  hotlist_rate_sources as (
    select distinct
      r.role_key,
      sh.id as source_id,
      coalesce(
        nullif(hm.hourly_rate_min, 0),
        nullif(sh.hourly_rate_min, 0)
      ) as min_rate,
      coalesce(
        nullif(hm.hourly_rate_max, 0),
        nullif(sh.hourly_rate_max, 0)
      ) as max_rate
    from latest_roles r
    join public.radar_match_hotlist hm
      on (
        lower(trim(hm.role_title)) = r.role_key
        or lower(trim(hm.role_title)) like '%' || r.role_key || '%'
        or r.role_key like '%' || lower(trim(hm.role_title)) || '%'
      )
    join public.social_hotlist sh
      on sh.id = hm.hotlist_id
      and coalesce(sh.posted_at, sh.created_at) >= now() - interval '30 days'
  ),
  observed_rates as (
    select
      role_key,
      case
        when min_rate is not null and max_rate is not null then (min_rate + max_rate) / 2.0
        else coalesce(min_rate, max_rate)
      end as rate
    from job_rate_sources

    union all

    select
      role_key,
      case
        when min_rate is not null and max_rate is not null then (min_rate + max_rate) / 2.0
        else coalesce(min_rate, max_rate)
      end as rate
    from hotlist_rate_sources
  ),
  rate_stats as (
    select
      role_key,
      avg(rate) filter (where rate > 0) as avg_rate
    from observed_rates
    group by role_key
  )
  update public.pulse_directory_30d_snapshot snapshot
  set avg_rate = stats.avg_rate
  from rate_stats stats
  where stats.role_key = snapshot.role_key
    and stats.avg_rate is not null;

  return v_refreshed_at;
end;
$$;

revoke all on function public.refresh_pulse_directory_30d_snapshot(boolean) from public;
grant execute on function public.refresh_pulse_directory_30d_snapshot(boolean)
  to authenticated, service_role;

select public.refresh_pulse_directory_30d_snapshot(true);
