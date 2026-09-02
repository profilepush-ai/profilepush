-- Recruiter/vendor avatar, captured from HarvestAPI's author.avatar.url by the
-- linkedin-group-posts-processor Worker and passed through receive-social-job.
-- These are signed LinkedIn CDN URLs that expire, so this is best-effort — the
-- frontend falls back to an initials avatar once a stored URL goes stale.
alter table public.social_jobs
  add column if not exists avatar_url text not null default '';

alter table public.social_hotlist
  add column if not exists bench_sales_recruiter_avatar_url text not null default '';
