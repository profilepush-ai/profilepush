create or replace function public.get_linkedin_group_performance_stats(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table (
  group_id text,
  scraped_posts_count bigint,
  social_jobs_count bigint,
  radar_results_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with scraped as (
    select posts.group_id, count(*)::bigint as scraped_posts_count
    from public.linkedin_groups_posts posts
    where (p_start is null or posts.scraped_at >= p_start)
      and (p_end is null or posts.scraped_at < p_end)
    group by posts.group_id
  ), jobs as (
    select social.group_id, count(*)::bigint as social_jobs_count
    from public.social_jobs social
    where social.platform = 'linkedin'
      and social.group_id is not null
      and (p_start is null or social.created_at >= p_start)
      and (p_end is null or social.created_at < p_end)
    group by social.group_id
  ), radar as (
    select social.group_id, count(matches.id)::bigint as radar_results_count
    from public.social_jobs social
    join public.radar_match_results matches
      on matches.job_source = 'social'
     and matches.job_id = social.id
    where social.platform = 'linkedin'
      and social.group_id is not null
      and (p_start is null or matches.created_at >= p_start)
      and (p_end is null or matches.created_at < p_end)
    group by social.group_id
  )
  select
    groups.group_id,
    coalesce(scraped.scraped_posts_count, 0)::bigint,
    coalesce(jobs.social_jobs_count, 0)::bigint,
    coalesce(radar.radar_results_count, 0)::bigint
  from public.linkedin_groups groups
  left join scraped on scraped.group_id = groups.group_id
  left join jobs on jobs.group_id = groups.group_id
  left join radar on radar.group_id = groups.group_id;
$$;

revoke all on function public.get_linkedin_group_performance_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_linkedin_group_performance_stats(timestamptz, timestamptz) to service_role;