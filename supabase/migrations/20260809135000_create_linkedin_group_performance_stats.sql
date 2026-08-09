create or replace view public.linkedin_group_performance_stats
with (security_invoker = true)
as
with scraped as (
  select group_id, count(*)::bigint as scraped_posts_count
  from public.linkedin_groups_posts
  group by group_id
), jobs as (
  select group_id, count(*)::bigint as social_jobs_count
  from public.social_jobs
  where platform = 'linkedin' and group_id is not null
  group by group_id
), radar as (
  select sj.group_id, count(rmr.id)::bigint as radar_results_count
  from public.social_jobs sj
  join public.radar_match_results rmr
    on rmr.job_source = 'social'
   and rmr.job_id = sj.id
  where sj.platform = 'linkedin' and sj.group_id is not null
  group by sj.group_id
)
select
  groups.group_id,
  coalesce(scraped.scraped_posts_count, 0)::bigint as scraped_posts_count,
  coalesce(jobs.social_jobs_count, 0)::bigint as social_jobs_count,
  coalesce(radar.radar_results_count, 0)::bigint as radar_results_count
from public.linkedin_groups groups
left join scraped on scraped.group_id = groups.group_id
left join jobs on jobs.group_id = groups.group_id
left join radar on radar.group_id = groups.group_id;

revoke all on public.linkedin_group_performance_stats from anon, authenticated;
grant select on public.linkedin_group_performance_stats to service_role;