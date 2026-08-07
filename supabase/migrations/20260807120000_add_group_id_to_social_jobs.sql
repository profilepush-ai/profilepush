-- Add source group identifier for social jobs so feed rows can be traced to origin groups.
ALTER TABLE public.social_jobs
  ADD COLUMN IF NOT EXISTS group_id text;

CREATE INDEX IF NOT EXISTS idx_social_jobs_group_id
  ON public.social_jobs (group_id)
  WHERE group_id IS NOT NULL AND btrim(group_id) <> '';
