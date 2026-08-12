-- Allow the Ask AI flow (pulse_ask_ai_requests / pulse_ask_ai_drafts / vendor_conversations)
-- to target hotlist leads (public.social_hotlist) in addition to job leads (public.social_jobs).

ALTER TABLE public.pulse_ask_ai_requests
  ALTER COLUMN job_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS hotlist_id uuid REFERENCES public.social_hotlist(id) ON DELETE CASCADE;

ALTER TABLE public.pulse_ask_ai_requests
  DROP CONSTRAINT IF EXISTS pulse_ask_ai_requests_lead_scope_check;
ALTER TABLE public.pulse_ask_ai_requests
  ADD CONSTRAINT pulse_ask_ai_requests_lead_scope_check
  CHECK ((job_id IS NOT NULL) <> (hotlist_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS pulse_ask_ai_requests_hotlist_idx
  ON public.pulse_ask_ai_requests (hotlist_id)
  WHERE hotlist_id IS NOT NULL;

ALTER TABLE public.pulse_ask_ai_drafts
  ALTER COLUMN job_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS hotlist_id uuid REFERENCES public.social_hotlist(id) ON DELETE CASCADE;

ALTER TABLE public.pulse_ask_ai_drafts
  DROP CONSTRAINT IF EXISTS pulse_ask_ai_drafts_lead_scope_check;
ALTER TABLE public.pulse_ask_ai_drafts
  ADD CONSTRAINT pulse_ask_ai_drafts_lead_scope_check
  CHECK ((job_id IS NOT NULL) <> (hotlist_id IS NOT NULL));

ALTER TABLE public.pulse_ask_ai_drafts
  DROP CONSTRAINT IF EXISTS pulse_ask_ai_drafts_job_details_unique;

CREATE UNIQUE INDEX IF NOT EXISTS pulse_ask_ai_drafts_job_details_unique
  ON public.pulse_ask_ai_drafts (job_id, missing_details_key) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pulse_ask_ai_drafts_hotlist_details_unique
  ON public.pulse_ask_ai_drafts (hotlist_id, missing_details_key) WHERE hotlist_id IS NOT NULL;

ALTER TABLE public.vendor_conversations
  ALTER COLUMN job_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS hotlist_id uuid REFERENCES public.social_hotlist(id) ON DELETE CASCADE;

ALTER TABLE public.vendor_conversations
  DROP CONSTRAINT IF EXISTS vendor_conversations_lead_scope_check;
ALTER TABLE public.vendor_conversations
  ADD CONSTRAINT vendor_conversations_lead_scope_check
  CHECK ((job_id IS NOT NULL) <> (hotlist_id IS NOT NULL));

-- Re-scope the job-scope enforcement trigger to also accept hotlist-scoped conversations.
CREATE OR REPLACE FUNCTION public.enforce_vendor_conversation_job_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.pulse_ask_ai_requests%ROWTYPE;
  v_job public.social_jobs%ROWTYPE;
  v_hotlist public.social_hotlist%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM public.pulse_ask_ai_requests
  WHERE request_id = NEW.request_id;

  IF v_request.request_id IS NULL THEN
    RAISE EXCEPTION 'Ask request not found';
  END IF;

  IF NEW.job_id IS DISTINCT FROM v_request.job_id
    OR NEW.hotlist_id IS DISTINCT FROM v_request.hotlist_id
    OR NEW.account_id <> v_request.account_id
    OR NEW.user_id <> v_request.user_id THEN
    RAISE EXCEPTION 'Conversation scope must match its Ask request';
  END IF;

  IF NEW.job_id IS NOT NULL THEN
    SELECT * INTO v_job
    FROM public.social_jobs
    WHERE id = NEW.job_id;

    IF v_job.id IS NULL THEN
      RAISE EXCEPTION 'Conversation job not found';
    END IF;

    IF NEW.vendor_id IS DISTINCT FROM v_job.vendor_id
      OR lower(trim(NEW.vendor_email)) IS DISTINCT FROM lower(trim(v_job.poster_email)) THEN
      RAISE EXCEPTION 'Conversation vendor must match its job';
    END IF;
  ELSE
    SELECT * INTO v_hotlist
    FROM public.social_hotlist
    WHERE id = NEW.hotlist_id;

    IF v_hotlist.id IS NULL THEN
      RAISE EXCEPTION 'Conversation hotlist lead not found';
    END IF;

    IF NEW.vendor_id IS NOT NULL
      OR lower(trim(NEW.vendor_email)) IS DISTINCT FROM lower(trim(v_hotlist.bench_sales_recruiter_email)) THEN
      RAISE EXCEPTION 'Conversation recruiter must match its hotlist lead';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_vendor_conversation_job_scope
  ON public.vendor_conversations;

CREATE TRIGGER enforce_vendor_conversation_job_scope
BEFORE INSERT OR UPDATE OF request_id, account_id, user_id, job_id, hotlist_id, vendor_id, vendor_email
ON public.vendor_conversations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_vendor_conversation_job_scope();

REVOKE ALL ON FUNCTION public.enforce_vendor_conversation_job_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_vendor_conversation_job_scope() TO service_role;

COMMENT ON TABLE public.vendor_conversations IS
  'One isolated vendor-mail thread per Ask request and lead (job or hotlist); conversations are never grouped by vendor.';

-- Mirrors get_pulse_asked_job_states(), scoped to hotlist leads. Hotlist leads have no
-- verification/reply-extraction pipeline, so a lead is simply "asked" once a completed
-- Ask AI request exists for it.
CREATE OR REPLACE FUNCTION public.get_hotlist_asked_states()
RETURNS TABLE(hotlist_id uuid, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    requests.hotlist_id,
    'asked'::text AS state
  FROM public.pulse_ask_ai_requests AS requests
  WHERE requests.hotlist_id IS NOT NULL
    AND requests.status = 'completed'
  GROUP BY requests.hotlist_id;
$$;

REVOKE ALL ON FUNCTION public.get_hotlist_asked_states() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hotlist_asked_states() TO authenticated, service_role;
