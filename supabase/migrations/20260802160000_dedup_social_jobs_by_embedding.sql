/*
  # Deduplicate social job matches using pgvector cosine similarity

  Creates an RPC function that:
  1. Takes an array of social_jobs IDs
  2. Groups them by vector similarity (cosine distance threshold)
  3. Returns only unique/representative job IDs (one per cluster)

  Jobs without embeddings fall through as unique (not dropped).
*/

CREATE OR REPLACE FUNCTION dedup_social_job_ids(
  job_ids uuid[],
  similarity_threshold float DEFAULT 0.92
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  rec RECORD;
  cluster_reps uuid[] := '{}';
  is_dup boolean;
  rep uuid;
BEGIN
  -- Loop through each job that has an embedding, ordered by created_at DESC
  -- so newer posts become cluster representatives
  FOR rec IN
    SELECT s.id, s.job_embedding
    FROM social_jobs s
    WHERE s.id = ANY(job_ids)
      AND s.job_embedding IS NOT NULL
    ORDER BY s.created_at DESC
  LOOP
    is_dup := false;
    -- Check if this job is similar to any existing cluster representative
    FOR rep IN
      SELECT u.id
      FROM social_jobs u
      WHERE u.id = ANY(cluster_reps)
        AND u.job_embedding IS NOT NULL
        AND 1 - (u.job_embedding <=> rec.job_embedding) >= similarity_threshold
      LIMIT 1
    LOOP
      is_dup := true;
    END LOOP;

    IF NOT is_dup THEN
      cluster_reps := array_append(cluster_reps, rec.id);
    END IF;
  END LOOP;

  -- Also include jobs without embeddings (don't drop them)
  FOR rec IN
    SELECT s.id
    FROM social_jobs s
    WHERE s.id = ANY(job_ids)
      AND s.job_embedding IS NULL
  LOOP
    cluster_reps := array_append(cluster_reps, rec.id);
  END LOOP;

  RETURN cluster_reps;
END;
$$;
