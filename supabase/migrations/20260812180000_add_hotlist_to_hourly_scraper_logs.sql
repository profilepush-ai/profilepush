create index if not exists idx_social_hotlist_created_at
  on public.social_hotlist (created_at);

create index if not exists idx_linkedin_keyword_posts_source_post_id
  on public.linkedin_keyword_posts (source_post_id);

drop function if exists public.get_hourly_linkedin_scraper_pipeline_logs(timestamptz, timestamptz);

create function public.get_hourly_linkedin_scraper_pipeline_logs(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  scraper_type text,
  hour_start timestamptz,
  scraped_posts_count bigint,
  social_jobs_count bigint,
  hotlist_count bigint,
  radar_results_count bigint,
  cost numeric
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
  ), hotlists as (
    select
      'group'::text as scraper_type,
      date_trunc('hour', hotlist.created_at) as hour_start,
      count(*)::bigint as row_count
    from public.social_hotlist hotlist
    where hotlist.platform = 'linkedin'
      and nullif(hotlist.group_id, '') is not null
      and hotlist.created_at >= p_start
      and hotlist.created_at < p_end
    group by date_trunc('hour', hotlist.created_at)

    union all

    select
      'keyword'::text,
      date_trunc('hour', hotlist.created_at),
      count(distinct hotlist.id)::bigint
    from public.social_hotlist hotlist
    where hotlist.platform = 'linkedin'
      and hotlist.created_at >= p_start
      and hotlist.created_at < p_end
      and exists (
        select 1
        from public.linkedin_keyword_posts posts
        where posts.source_post_id = hotlist.source_post_id
      )
    group by date_trunc('hour', hotlist.created_at)
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
  ), costs as (
    select
      'group'::text as scraper_type,
      date_trunc('hour', runs.completed_at) as hour_start,
      sum(coalesce(runs.harvest_cost, 0)) as cost
    from public.linkedin_group_scrape_runs runs
    where runs.completed_at >= p_start and runs.completed_at < p_end
    group by date_trunc('hour', runs.completed_at)

    union all

    select
      'keyword'::text,
      date_trunc('hour', runs.completed_at),
      sum(coalesce(runs.harvest_cost, 0))
    from public.linkedin_keyword_scrape_runs runs
    where runs.completed_at >= p_start and runs.completed_at < p_end
    group by date_trunc('hour', runs.completed_at)
  )
  select
    types.scraper_type,
    hours.hour_start,
    coalesce(scraped.row_count, 0)::bigint,
    coalesce(jobs.row_count, 0)::bigint,
    coalesce(hotlists.row_count, 0)::bigint,
    coalesce(radar.row_count, 0)::bigint,
    coalesce(costs.cost, 0)::numeric
  from hours
  cross join scraper_types types
  left join scraped using (scraper_type, hour_start)
  left join jobs using (scraper_type, hour_start)
  left join hotlists using (scraper_type, hour_start)
  left join radar using (scraper_type, hour_start)
  left join costs using (scraper_type, hour_start)
  order by hours.hour_start desc, types.scraper_type;
$$;

revoke all on function public.get_hourly_linkedin_scraper_pipeline_logs(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_hourly_linkedin_scraper_pipeline_logs(timestamptz, timestamptz) to service_role;