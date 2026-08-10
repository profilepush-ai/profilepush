CREATE OR REPLACE FUNCTION public.enforce_vendor_conversation_job_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.pulse_ask_ai_requests%ROWTYPE;
  v_job public.social_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM public.pulse_ask_ai_requests
  WHERE request_id = NEW.request_id;

  IF v_request.request_id IS NULL THEN
    RAISE EXCEPTION 'Ask request not found';
  END IF;

  IF NEW.job_id <> v_request.job_id
    OR NEW.account_id <> v_request.account_id
    OR NEW.user_id <> v_request.user_id THEN
    RAISE EXCEPTION 'Conversation scope must match its Ask request';
  END IF;

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_vendor_conversation_job_scope
  ON public.vendor_conversations;

CREATE TRIGGER enforce_vendor_conversation_job_scope
BEFORE INSERT OR UPDATE OF request_id, account_id, user_id, job_id, vendor_id, vendor_email
ON public.vendor_conversations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_vendor_conversation_job_scope();

REVOKE ALL ON FUNCTION public.enforce_vendor_conversation_job_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_vendor_conversation_job_scope() TO service_role;

COMMENT ON TABLE public.vendor_conversations IS
  'One isolated vendor-mail thread per Ask request and job; conversations are never grouped by vendor.';