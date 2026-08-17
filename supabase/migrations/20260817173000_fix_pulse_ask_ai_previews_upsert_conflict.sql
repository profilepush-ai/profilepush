-- The partial unique indexes on pulse_ask_ai_previews (WHERE job_id/hotlist_id
-- IS NOT NULL) can't be targeted by a plain `ON CONFLICT (columns)` upsert —
-- Postgres requires the ON CONFLICT clause's predicate to match the index
-- exactly, which PostgREST's upsert doesn't support specifying. Every upsert
-- was failing outright with 42P10 ("no unique or exclusion constraint
-- matching the ON CONFLICT specification"), so no generated email was ever
-- actually being logged.
--
-- Fix: replace the two partial indexes with one ordinary (non-partial) unique
-- constraint on a generated column that's always non-null, which a plain
-- ON CONFLICT can target directly.

DROP INDEX IF EXISTS public.pulse_ask_ai_previews_user_job_idx;
DROP INDEX IF EXISTS public.pulse_ask_ai_previews_user_hotlist_idx;

ALTER TABLE public.pulse_ask_ai_previews
  ADD COLUMN lead_key text GENERATED ALWAYS AS (COALESCE(job_id::text, hotlist_id::text)) STORED;

ALTER TABLE public.pulse_ask_ai_previews
  ADD CONSTRAINT pulse_ask_ai_previews_user_lead_key_key UNIQUE (user_id, lead_key);
