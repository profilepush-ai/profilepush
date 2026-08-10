CREATE TABLE public.vendor_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.pulse_ask_ai_requests(request_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.social_jobs(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.social_vendors(id) ON DELETE SET NULL,
  vendor_name text NOT NULL,
  vendor_email text NOT NULL,
  subject text NOT NULL,
  reply_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'open', 'replied', 'closed', 'failed')),
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vendor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.vendor_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'vendor', 'system')),
  from_email text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL DEFAULT '',
  html_body text,
  mailgun_message_id text UNIQUE,
  internet_message_id text UNIQUE,
  in_reply_to text,
  message_references text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'accepted', 'delivered', 'temporary_failed', 'failed', 'received')),
  error_message text,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vendor_message_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id uuid REFERENCES public.vendor_messages(id) ON DELETE CASCADE,
  provider_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  severity text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vendor_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.vendor_messages(id) ON DELETE CASCADE,
  r2_object_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  scan_status text NOT NULL DEFAULT 'pending'
    CHECK (scan_status IN ('pending', 'clean', 'blocked', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vendor_mail_webhook_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  webhook_type text NOT NULL CHECK (webhook_type IN ('inbound', 'event')),
  provider_token text NOT NULL,
  provider_timestamp bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (webhook_type, provider_token)
);

ALTER TABLE public.pulse_ask_ai_requests
  ADD COLUMN conversation_id uuid UNIQUE REFERENCES public.vendor_conversations(id) ON DELETE SET NULL;

CREATE INDEX vendor_conversations_user_last_message_idx
  ON public.vendor_conversations (user_id, last_message_at DESC);
CREATE INDEX vendor_conversations_account_last_message_idx
  ON public.vendor_conversations (account_id, last_message_at DESC);
CREATE INDEX vendor_conversations_vendor_email_idx
  ON public.vendor_conversations (lower(vendor_email));
CREATE INDEX vendor_messages_conversation_created_idx
  ON public.vendor_messages (conversation_id, created_at);
CREATE INDEX vendor_message_events_message_created_idx
  ON public.vendor_message_events (message_id, created_at DESC);
CREATE INDEX vendor_message_attachments_message_idx
  ON public.vendor_message_attachments (message_id);
CREATE INDEX vendor_mail_webhook_receipts_created_idx
  ON public.vendor_mail_webhook_receipts (created_at);

ALTER TABLE public.vendor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_mail_webhook_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.vendor_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vendor_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vendor_message_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vendor_message_attachments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vendor_mail_webhook_receipts FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.vendor_conversations TO authenticated;
GRANT SELECT ON public.vendor_messages TO authenticated;
GRANT SELECT ON public.vendor_message_events TO authenticated;
GRANT SELECT ON public.vendor_message_attachments TO authenticated;
GRANT ALL ON public.vendor_conversations, public.vendor_messages, public.vendor_message_events,
  public.vendor_message_attachments, public.vendor_mail_webhook_receipts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.vendor_message_events_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.vendor_mail_webhook_receipts_id_seq TO service_role;

CREATE POLICY select_own_vendor_conversations
  ON public.vendor_conversations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY select_own_vendor_messages
  ON public.vendor_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vendor_conversations conversation
    WHERE conversation.id = vendor_messages.conversation_id
      AND conversation.user_id = auth.uid()
  ));

CREATE POLICY select_own_vendor_message_events
  ON public.vendor_message_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.vendor_messages message
    JOIN public.vendor_conversations conversation ON conversation.id = message.conversation_id
    WHERE message.id = vendor_message_events.message_id
      AND conversation.user_id = auth.uid()
  ));

CREATE POLICY select_own_vendor_message_attachments
  ON public.vendor_message_attachments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.vendor_messages message
    JOIN public.vendor_conversations conversation ON conversation.id = message.conversation_id
    WHERE message.id = vendor_message_attachments.message_id
      AND conversation.user_id = auth.uid()
  ));

ALTER PUBLICATION supabase_realtime ADD TABLE public.vendor_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vendor_messages;

COMMENT ON COLUMN public.vendor_conversations.reply_token IS
  'Opaque routing token used only in the Mailgun Reply-To address; sender validation is still required.';

CREATE FUNCTION public.increment_vendor_conversation_unread(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.vendor_conversations
  SET unread_count = unread_count + 1,
      status = 'replied',
      last_message_at = now(),
      updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_vendor_conversation_unread(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_vendor_conversation_unread(uuid) TO service_role;

CREATE FUNCTION public.update_own_vendor_conversation(
  p_conversation_id uuid,
  p_action text
)
RETURNS public.vendor_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation public.vendor_conversations;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.vendor_conversations
  SET unread_count = CASE WHEN p_action = 'read' THEN 0 ELSE unread_count END,
      status = CASE
        WHEN p_action = 'close' THEN 'closed'
        WHEN p_action = 'reopen' AND status = 'closed' THEN 'open'
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_conversation_id
    AND user_id = auth.uid()
    AND p_action IN ('read', 'close', 'reopen')
  RETURNING * INTO v_conversation;

  IF v_conversation.id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;
  RETURN v_conversation;
END;
$$;

REVOKE ALL ON FUNCTION public.update_own_vendor_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_own_vendor_conversation(uuid, text) TO authenticated;

CREATE FUNCTION public.fail_vendor_message_and_refund(
  p_message_id uuid,
  p_error_message text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.pulse_ask_ai_requests%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.vendor_messages
  SET status = 'failed',
      error_message = LEFT(COALESCE(p_error_message, 'Permanent email delivery failure'), 2000),
      updated_at = now()
  WHERE id = p_message_id;

  SELECT request.* INTO v_request
  FROM public.vendor_messages message
  JOIN public.vendor_conversations conversation ON conversation.id = message.conversation_id
  JOIN public.pulse_ask_ai_requests request ON request.request_id = conversation.request_id
  WHERE message.id = p_message_id
    AND message.id = (
      SELECT initial_message.id
      FROM public.vendor_messages initial_message
      WHERE initial_message.conversation_id = message.conversation_id
        AND initial_message.direction = 'outbound'
      ORDER BY initial_message.created_at, initial_message.id
      LIMIT 1
    )
  FOR UPDATE OF request;

  IF v_request.request_id IS NULL OR v_request.status <> 'completed' OR v_request.charged_amount <= 0 THEN
    RETURN false;
  END IF;

  UPDATE public.pulse_ask_ai_requests
  SET status = 'refunded',
      error_message = LEFT(COALESCE(p_error_message, 'Permanent email delivery failure'), 2000),
      updated_at = now()
  WHERE request_id = v_request.request_id
    AND status = 'completed';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.accounts
  SET credits_balance = ROUND(COALESCE(credits_balance, 0) + v_request.charged_amount, 4)
  WHERE id = v_request.account_id;

  INSERT INTO public.credit_transactions (account_id, type, amount, description)
  VALUES (v_request.account_id, 'refund', v_request.charged_amount, 'Pulse refund: permanent vendor email failure');

  UPDATE public.vendor_conversations
  SET status = 'failed', updated_at = now()
  WHERE id = (SELECT conversation_id FROM public.vendor_messages WHERE id = p_message_id);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_vendor_message_and_refund(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_vendor_message_and_refund(uuid, text) TO service_role;