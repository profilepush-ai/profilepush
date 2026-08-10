ALTER TABLE public.vendor_conversations
  ADD COLUMN sender_name text;

UPDATE public.vendor_conversations conversation
SET sender_name = COALESCE(
  (
    SELECT NULLIF(TRIM(REGEXP_REPLACE(message.from_email, '\s+via ProfilePush.*$', '', 'i')), '')
    FROM public.vendor_messages message
    WHERE message.conversation_id = conversation.id
      AND message.direction = 'outbound'
    ORDER BY message.created_at, message.id
    LIMIT 1
  ),
  'ProfilePush Recruiter'
);

ALTER TABLE public.vendor_conversations
  ALTER COLUMN sender_name SET DEFAULT 'ProfilePush Recruiter',
  ALTER COLUMN sender_name SET NOT NULL;

ALTER TABLE public.vendor_messages
  ADD COLUMN client_request_id uuid UNIQUE;

COMMENT ON COLUMN public.vendor_conversations.sender_name IS
  'Stable user-facing sender name used for outbound From and Reply-To display names.';

COMMENT ON COLUMN public.vendor_messages.client_request_id IS
  'Client-generated idempotency key preventing duplicate manual sends.';