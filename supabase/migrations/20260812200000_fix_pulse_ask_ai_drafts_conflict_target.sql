-- The two partial unique indexes added in 20260812190000 cannot be used as an ON CONFLICT
-- target by Supabase's upsert() (PostgREST builds a plain ON CONFLICT (cols) with no WHERE
-- clause, and Postgres only matches a partial unique index when the same predicate is
-- repeated in the conflict clause). Replace them with one plain unique index on a generated
-- column that coalesces whichever lead id is set, so a single ON CONFLICT target works for
-- both job- and hotlist-scoped drafts.

ALTER TABLE public.pulse_ask_ai_drafts
  ADD COLUMN IF NOT EXISTS lead_key text
  GENERATED ALWAYS AS (COALESCE(job_id::text, hotlist_id::text)) STORED;

ALTER TABLE public.pulse_ask_ai_drafts
  ALTER COLUMN lead_key SET NOT NULL;

DROP INDEX IF EXISTS public.pulse_ask_ai_drafts_job_details_unique;
DROP INDEX IF EXISTS public.pulse_ask_ai_drafts_hotlist_details_unique;

CREATE UNIQUE INDEX IF NOT EXISTS pulse_ask_ai_drafts_lead_details_unique
  ON public.pulse_ask_ai_drafts (lead_key, missing_details_key);
