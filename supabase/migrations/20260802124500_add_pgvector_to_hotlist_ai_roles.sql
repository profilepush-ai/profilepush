-- Enable role-level semantic search for hotlist roles.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotlist_ai_roles'
      AND column_name = 'role_embedding'
  ) THEN
    ALTER TABLE public.hotlist_ai_roles ADD COLUMN role_embedding extensions.vector(768);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hotlist_ai_roles_embedding
  ON public.hotlist_ai_roles
  USING ivfflat (role_embedding extensions.vector_cosine_ops)
  WITH (lists = 50);

CREATE OR REPLACE FUNCTION public.match_hotlist_roles_by_embedding(
  p_account_id uuid,
  p_query_embedding extensions.vector(768),
  p_similarity_threshold float DEFAULT 0.6,
  p_max_results int DEFAULT 50
)
RETURNS TABLE (
  role_id uuid,
  account_id uuid,
  target_role text,
  category text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id AS role_id,
    r.account_id,
    r.target_role,
    r.category,
    1 - (r.role_embedding <=> p_query_embedding) AS similarity
  FROM public.hotlist_ai_roles r
  WHERE r.account_id = p_account_id
    AND r.role_embedding IS NOT NULL
    AND r.is_active = true
    AND r.schedule_frequency <> 'disabled'
    AND (1 - (r.role_embedding <=> p_query_embedding)) >= p_similarity_threshold
  ORDER BY similarity DESC
  LIMIT p_max_results;
END;
$$;
