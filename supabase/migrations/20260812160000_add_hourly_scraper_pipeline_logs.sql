create or replace function public.get_hourly_linkedin_scraper_pipeline_logs(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  scraper_type text,
  hour_start timestamptz,
  scraped_posts_count bigint,
  social_jobs_count bigint,
  radar_results_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with hours as (
    select generate_series(
      date_trunc('hour', p_start),
      date_trunc('hour', p_end - interval '1 microsecond'),
      interval '1 hour'
    ) as hour_start
  ), scraper_types as (
    select unnest(array['group', 'keyword']) as scraper_type
  ), scraped as (
    select
      'group'::text as scraper_type,
      date_trunc('hour', posts.first_seen_at) as hour_start,
      count(*)::bigint as row_count
    from public.linkedin_groups_posts posts
    where posts.first_seen_at >= p_start and posts.first_seen_at < p_end
    group by date_trunc('hour', posts.first_seen_at)

    union all

    select
      'keyword'::text,
      date_trunc('hour', posts.first_seen_at),
      count(*)::bigint
    from public.linkedin_keyword_posts posts
    where posts.first_seen_at >= p_start and posts.first_seen_at < p_end
    group by date_trunc('hour', posts.first_seen_at)
  ), jobs as (
    select
      'group'::text as scraper_type,
      date_trunc('hour', social.created_at) as hour_start,
      count(distinct social.id)::bigint as row_count
    from public.social_jobs social
    where social.platform = 'linkedin'
      and nullif(social.group_id, '') is not null
      and social.created_at >= p_start
      and social.created_at < p_end
    group by date_trunc('hour', social.created_at)

    union all

    select
      'keyword'::text,
      date_trunc('hour', links.created_at),
      count(*)::bigint
    from public.linkedin_keyword_social_jobs links
    where links.created_at >= p_start and links.created_at < p_end
    group by date_trunc('hour', links.created_at)
  ), radar as (
    select
      'group'::text as scraper_type,
      date_trunc('hour', matches.created_at) as hour_start,
      count(*)::bigint as row_count
    from public.radar_match_results matches
    join public.social_jobs social
      on matches.job_source = 'social'
     and matches.job_id = social.id
    where social.platform = 'linkedin'
      and nullif(social.group_id, '') is not null
      and matches.created_at >= p_start
      and matches.created_at < p_end
    group by date_trunc('hour', matches.created_at)

    union all

    select
      'keyword'::text,
      date_trunc('hour', matches.created_at),
      count(*)::bigint
    from public.linkedin_keyword_social_jobs links
    join public.radar_match_results matches
      on matches.job_source = 'social'
     and matches.job_id = links.social_job_id
    where matches.created_at >= p_start and matches.created_at < p_end
    group by date_trunc('hour', matches.created_at)
  )
  select
    types.scraper_type,
    hours.hour_start,
    coalesce(scraped.row_count, 0)::bigint,
    coalesce(jobs.row_count, 0)::bigint,
    coalesce(radar.row_count, 0)::bigint
  from hours
  cross join scraper_types types
  left join scraped using (scraper_type, hour_start)
  left join jobs using (scraper_type, hour_start)
  left join radar using (scraper_type, hour_start)
  order by hours.hour_start desc, types.scraper_type;
$$;

revoke all on function public.get_hourly_linkedin_scraper_pipeline_logs(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_hourly_linkedin_scraper_pipeline_logs(timestamptz, timestamptz) to service_role;