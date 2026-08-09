delete from public.radar_match_results matches
using public.social_jobs jobs
where matches.job_source = 'social'
  and matches.job_id = jobs.id
  and jobs.platform = 'linkedin'
  and jobs.group_id is not null
  and jobs.post_id = jobs.group_id
  and jobs.post_url like '%urn:li:groupPost:' || jobs.group_id || '-%';

delete from public.social_jobs
where platform = 'linkedin'
  and group_id is not null
  and post_id = group_id
  and post_url like '%urn:li:groupPost:' || group_id || '-%';