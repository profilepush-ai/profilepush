-- Vector-ranked search for Pulse social feed using hotlist role embeddings.
-- This allows role-like free text queries (e.g., "Solutions Architect")
-- to return semantically similar social jobs via pgvector.

CREATE OR REPLACE FUNCTION public.search_pulse_social_feed_vector(
  p_role_query text,
  p_limit integer DEFAULT 500,
  p_similarity_threshold double precision DEFAULT 0.58
)
RETURNS TABLE (
  lead_id text,
  matched_role text,
  similarity double precision
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH normalized AS (
    SELECT nullif(trim(lower(coalesce(p_role_query, ''))), '') AS role_query
  ),
  role_choice AS (
    SELECT
      r.target_role,
      r.role_embedding,
      CASE
        WHEN lower(trim(r.target_role)) = n.role_query THEN 0
        WHEN lower(trim(r.target_role)) LIKE ('%' || n.role_query || '%') THEN 1
        WHEN n.role_query LIKE ('%' || lower(trim(r.target_role)) || '%') THEN 2
        ELSE 3
      END AS match_rank
    FROM normalized n
    JOIN public.hotlist_ai_roles r ON n.role_query IS NOT NULL
    WHERE r.role_embedding IS NOT NULL
    ORDER BY
      match_rank ASC,
      abs(char_length(lower(trim(r.target_role))) - char_length(n.role_query)) ASC,
      r.updated_at DESC NULLS LAST
    LIMIT 1
  ),
  scored AS (
    SELECT
      sj.id::text AS lead_id,
      rc.target_role AS matched_role,
      (1 - (rc.role_embedding <=> sj.job_embedding))::double precision AS similarity
    FROM role_choice rc
    JOIN public.social_jobs sj
      ON sj.job_embedding IS NOT NULL
     AND sj.poster_email IS NOT NULL
     AND sj.poster_email <> ''
    WHERE EXISTS (
      SELECT 1
      FROM public.radar_match_results rmr
      WHERE rmr.job_source = 'social'
        AND rmr.job_id = sj.id::text
    )
  )
  SELECT
    scored.lead_id,
    scored.matched_role,
    scored.similarity
  FROM scored
  WHERE scored.similarity >= coalesce(p_similarity_threshold, 0.58)
  ORDER BY scored.similarity DESC
  LIMIT greatest(1, least(coalesce(p_limit, 500), 5000));
$$;

REVOKE ALL ON FUNCTION public.search_pulse_social_feed_vector(text, integer, double precision) FROM public;
GRANT EXECUTE ON FUNCTION public.search_pulse_social_feed_vector(text, integer, double precision) TO authenticated;
