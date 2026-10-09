/*
# Index for the career-site branch of the Feed

The career-site branch of pulse_feed_jobs_rows filtered social_jobs by
post_source with no index, so every Feed page scanned the table: 145 ms ->
182 ms with ~300 career rows, growing with them. Same pattern as
idx_social_jobs_user_post. Measured (rolled back): 182 ms -> 108 ms.
*/
create index if not exists idx_social_jobs_career_site_open
  on public.social_jobs (post_source)
  where post_source = 'career_site' and hidden_at is null;
