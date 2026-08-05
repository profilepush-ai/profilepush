-- Returns job_count and vendor_count per role using vector cosine similarity
-- between hotlist_ai_roles.role_embedding and social_jobs.job_embedding.
-- Only counts jobs that have been extracted (exist in radar_match_results)
-- and have a poster_email present.

CREATE OR REPLACE FUNCTION get_profile_stats_by_vector(
  p_target_roles text[],
  p_similarity_threshold float DEFAULT 0.65
)
RETURNS TABLE (
  target_role text,
  job_count   bigint,
  vendor_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  WITH role_embeddings AS (
    SELECT DISTINCT ON (lower(trim(r.target_role)))
      lower(trim(r.target_role)) AS role_key,
      r.target_role              AS role_label,
      r.role_embedding
    FROM hotlist_ai_roles r
    WHERE lower(trim(r.target_role)) = ANY(
      SELECT lower(trim(unnest)) FROM unnest(p_target_roles)
    )
      AND r.role_embedding IS NOT NULL
    ORDER BY lower(trim(r.target_role)), r.updated_at DESC NULLS LAST
  ),
  matched_jobs AS (
    SELECT
      re.role_key,
      sj.id          AS job_id,
      sj.poster_email
    FROM role_embeddings re
    JOIN social_jobs sj
      ON sj.job_embedding IS NOT NULL
      AND sj.poster_email IS NOT NULL
      AND sj.poster_email != ''
      AND (1 - (re.role_embedding <=> sj.job_embedding)) >= p_similarity_threshold
    WHERE EXISTS (
      SELECT 1
      FROM radar_match_results rmr
      WHERE rmr.job_id   = sj.id::text
        AND rmr.job_source = 'social'
    )
  )
  SELECT
    re.role_label                          AS target_role,
    COUNT(DISTINCT mj.job_id)::bigint      AS job_count,
    COUNT(DISTINCT mj.poster_email)::bigint AS vendor_count
  FROM role_embeddings re
  LEFT JOIN matched_jobs mj ON mj.role_key = re.role_key
  GROUP BY re.role_label;
END;
$$;
