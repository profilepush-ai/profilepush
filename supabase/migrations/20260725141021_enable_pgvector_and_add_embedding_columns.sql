/*
# Enable pgvector and add embedding columns to job tables and profiles

1. Extensions
   - Enables the `vector` extension for similarity search capabilities

2. Modified Tables (new columns)
   - `profiles`: adds `profile_embedding` (vector(768)) for candidate embeddings
   - `linkedin_jobs`: adds `job_embedding` (vector(768)) for job embeddings
   - `dice_jobs`: adds `job_embedding` (vector(768)) for job embeddings
   - `indeed_jobs`: adds `job_embedding` (vector(768)) for job embeddings
   - `monster_jobs`: adds `job_embedding` (vector(768)) for job embeddings
   - `careerbuilder_jobs`: adds `job_embedding` (vector(768)) for job embeddings
   - `social_jobs`: adds `job_embedding` (vector(768)) for job embeddings

3. Indexes
   - Creates IVFFlat indexes on each embedding column for fast similarity search
   - Uses cosine distance operator for all indexes

4. Notes
   - 768 dimensions chosen for compatibility with both Gemini text-embedding-004 (768d) and OpenAI text-embedding-3-small (configurable to 768d)
   - IVFFlat indexes use lists=100 which is appropriate for tables up to ~100k rows
   - Indexes are created with IF NOT EXISTS for idempotency
*/

-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Add embedding columns to profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'profile_embedding') THEN
    ALTER TABLE profiles ADD COLUMN profile_embedding vector(768);
  END IF;
END $$;

-- Add embedding columns to linkedin_jobs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'linkedin_jobs' AND column_name = 'job_embedding') THEN
    ALTER TABLE linkedin_jobs ADD COLUMN job_embedding vector(768);
  END IF;
END $$;

-- Add embedding columns to dice_jobs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dice_jobs' AND column_name = 'job_embedding') THEN
    ALTER TABLE dice_jobs ADD COLUMN job_embedding vector(768);
  END IF;
END $$;

-- Add embedding columns to indeed_jobs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'indeed_jobs' AND column_name = 'job_embedding') THEN
    ALTER TABLE indeed_jobs ADD COLUMN job_embedding vector(768);
  END IF;
END $$;

-- Add embedding columns to monster_jobs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'monster_jobs' AND column_name = 'job_embedding') THEN
    ALTER TABLE monster_jobs ADD COLUMN job_embedding vector(768);
  END IF;
END $$;

-- Add embedding columns to careerbuilder_jobs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'careerbuilder_jobs' AND column_name = 'job_embedding') THEN
    ALTER TABLE careerbuilder_jobs ADD COLUMN job_embedding vector(768);
  END IF;
END $$;

-- Add embedding columns to social_jobs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'social_jobs' AND column_name = 'job_embedding') THEN
    ALTER TABLE social_jobs ADD COLUMN job_embedding vector(768);
  END IF;
END $$;

-- Create indexes for fast similarity search (IVFFlat with cosine distance)
-- Note: IVFFlat indexes require some data to exist before they work optimally.
-- We use lists=50 which works well for tables with up to ~50k rows.

CREATE INDEX IF NOT EXISTS idx_profiles_embedding ON profiles
  USING ivfflat (profile_embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_linkedin_jobs_embedding ON linkedin_jobs
  USING ivfflat (job_embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_dice_jobs_embedding ON dice_jobs
  USING ivfflat (job_embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_indeed_jobs_embedding ON indeed_jobs
  USING ivfflat (job_embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_monster_jobs_embedding ON monster_jobs
  USING ivfflat (job_embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_careerbuilder_jobs_embedding ON careerbuilder_jobs
  USING ivfflat (job_embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_social_jobs_embedding ON social_jobs
  USING ivfflat (job_embedding vector_cosine_ops) WITH (lists = 50);

-- Create a helper function for cosine similarity search across job tables
CREATE OR REPLACE FUNCTION match_jobs_by_embedding(
  query_embedding vector(768),
  similarity_threshold float DEFAULT 0.7,
  max_results int DEFAULT 200
)
RETURNS TABLE (
  job_id uuid,
  job_source text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT lj.id AS job_id, 'linkedin'::text AS job_source,
           1 - (lj.job_embedding <=> query_embedding) AS similarity
    FROM linkedin_jobs lj
    WHERE lj.job_embedding IS NOT NULL

    UNION ALL

    SELECT dj.id AS job_id, 'dice'::text AS job_source,
           1 - (dj.job_embedding <=> query_embedding) AS similarity
    FROM dice_jobs dj
    WHERE dj.job_embedding IS NOT NULL

    UNION ALL

    SELECT ij.id AS job_id, 'indeed'::text AS job_source,
           1 - (ij.job_embedding <=> query_embedding) AS similarity
    FROM indeed_jobs ij
    WHERE ij.job_embedding IS NOT NULL

    UNION ALL

    SELECT mj.id AS job_id, 'monster'::text AS job_source,
           1 - (mj.job_embedding <=> query_embedding) AS similarity
    FROM monster_jobs mj
    WHERE mj.job_embedding IS NOT NULL

    UNION ALL

    SELECT cbj.id AS job_id, 'careerbuilder'::text AS job_source,
           1 - (cbj.job_embedding <=> query_embedding) AS similarity
    FROM careerbuilder_jobs cbj
    WHERE cbj.job_embedding IS NOT NULL

    UNION ALL

    SELECT sj.id AS job_id, 'social'::text AS job_source,
           1 - (sj.job_embedding <=> query_embedding) AS similarity
    FROM social_jobs sj
    WHERE sj.job_embedding IS NOT NULL
  ) all_jobs
  WHERE all_jobs.similarity >= similarity_threshold
  ORDER BY all_jobs.similarity DESC
  LIMIT max_results;
END;
$$;
