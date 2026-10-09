/*
# Feed filter counts: cached for the unfiltered windows

get_pulse_social_feed_facets computes the filter counts (experience, work
type, employment type, visa) over every post in the window: ~2.4 s for 30
days on an idle database. The Feed runs it next to its other queries, and
under that load it passed the 8 s statement limit for signed-in users, so the
counts came back empty (and the Feed could sit blank while it waited).

The counts with no filter set are the same for everyone, so they are now
computed every 10 minutes for the four Feed windows (24h, 3d, 7d, 30d) and
read from a table. Any filter or search still computes live.
*/

alter function public.get_pulse_social_feed_facets(timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric)
  rename to get_pulse_social_feed_facets_live;
revoke all on function public.get_pulse_social_feed_facets_live(timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric) from public, anon, authenticated;

create table if not exists public.pulse_feed_facets_cache (
  hours integer primary key,
  rows jsonb not null,
  refreshed_at timestamptz not null default now()
);
alter table public.pulse_feed_facets_cache enable row level security;

create or replace function public.get_pulse_social_feed_facets(
  p_since timestamptz, p_query text default null, p_experience_ranges text[] default null, p_work_types text[] default null,
  p_employment_types text[] default null, p_visa_statuses text[] default null, p_locations text[] default null,
  p_skills_query text default null, p_rate_mode text default null, p_rate_min numeric default null, p_rate_max numeric default null)
returns table(facet_category text, facet_value text, facet_count bigint)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_hours integer;
  v_rows jsonb;
begin
  if nullif(btrim(coalesce(p_query, '')), '') is null
     and coalesce(array_length(p_experience_ranges, 1), 0) = 0 and coalesce(array_length(p_work_types, 1), 0) = 0
     and coalesce(array_length(p_employment_types, 1), 0) = 0 and coalesce(array_length(p_visa_statuses, 1), 0) = 0
     and coalesce(array_length(p_locations, 1), 0) = 0 and nullif(btrim(coalesce(p_skills_query, '')), '') is null
     and p_rate_mode is null then
    v_hours := round(extract(epoch from now() - coalesce(p_since, now() - interval '72 hours')) / 3600);
    select c.rows into v_rows from public.pulse_feed_facets_cache c
    where c.hours = v_hours and c.refreshed_at > now() - interval '30 minutes';
    if v_rows is not null then
      return query select x.facet_category, x.facet_value, x.facet_count
        from jsonb_to_recordset(v_rows) as x(facet_category text, facet_value text, facet_count bigint);
      return;
    end if;
  end if;
  return query select * from public.get_pulse_social_feed_facets_live(
    p_since, p_query, p_experience_ranges, p_work_types, p_employment_types, p_visa_statuses, p_locations,
    p_skills_query, p_rate_mode, p_rate_min, p_rate_max);
end;
$$;
grant execute on function public.get_pulse_social_feed_facets(timestamptz, text, text[], text[], text[], text[], text[], text, text, numeric, numeric) to anon, authenticated;

create or replace function public.refresh_pulse_feed_facets_cache()
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  h integer;
begin
  foreach h in array array[24, 72, 168, 720] loop
    insert into public.pulse_feed_facets_cache (hours, rows, refreshed_at)
    select h, coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb), now()
    from public.get_pulse_social_feed_facets_live(now() - make_interval(hours => h)) f
    on conflict (hours) do update set rows = excluded.rows, refreshed_at = excluded.refreshed_at;
  end loop;
end;
$$;
revoke all on function public.refresh_pulse_feed_facets_cache() from public, anon, authenticated;

select public.refresh_pulse_feed_facets_cache();

do $cron$
begin
  perform cron.unschedule('refresh-feed-facets')
  where exists (select 1 from cron.job where jobname = 'refresh-feed-facets');
  perform cron.schedule('refresh-feed-facets', '1-59/10 * * * *', 'select public.refresh_pulse_feed_facets_cache();');
end;
$cron$;
