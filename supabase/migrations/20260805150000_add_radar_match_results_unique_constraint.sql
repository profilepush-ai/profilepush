-- Deduplicate radar_match_results keeping the latest row per (job_id, job_source),
-- then add a unique constraint so upsert works reliably.
DELETE FROM public.radar_match_results
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY job_id, job_source ORDER BY created_at DESC NULLS LAST) AS rn
    FROM public.radar_match_results
  ) t
  WHERE rn > 1
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'radar_match_results_job_id_job_source_key'
      AND conrelid = 'public.radar_match_results'::regclass
  ) THEN
    ALTER TABLE public.radar_match_results
      ADD CONSTRAINT radar_match_results_job_id_job_source_key UNIQUE (job_id, job_source);
  END IF;
END $$;
