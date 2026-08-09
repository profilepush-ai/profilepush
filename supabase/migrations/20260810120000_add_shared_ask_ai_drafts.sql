CREATE TABLE IF NOT EXISTS public.pulse_ask_ai_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.social_jobs(id) ON DELETE CASCADE,
  missing_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_details_key text NOT NULL,
  email_subject text NOT NULL,
  email_content_template text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pulse_ask_ai_drafts_job_details_unique UNIQUE (job_id, missing_details_key)
);

CREATE INDEX IF NOT EXISTS pulse_ask_ai_drafts_job_idx
  ON public.pulse_ask_ai_drafts (job_id, updated_at DESC);

ALTER TABLE public.pulse_ask_ai_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pulse_ask_ai_drafts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pulse_ask_ai_drafts TO service_role;

COMMENT ON TABLE public.pulse_ask_ai_drafts IS
  'Shared cached Ask Vendor email drafts; sender placeholders are hydrated by the authenticated Edge Function.';