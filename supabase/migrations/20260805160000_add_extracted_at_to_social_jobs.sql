-- Add extracted_at timestamp to social_jobs to track which rows have been through Gemini extraction.
ALTER TABLE public.social_jobs
  ADD COLUMN IF NOT EXISTS extracted_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS social_jobs_extracted_at_idx
  ON public.social_jobs (extracted_at)
  WHERE extracted_at IS NULL;
