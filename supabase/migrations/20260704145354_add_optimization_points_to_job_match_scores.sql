ALTER TABLE job_match_scores
  ADD COLUMN IF NOT EXISTS optimization_points jsonb NOT NULL DEFAULT '[]';