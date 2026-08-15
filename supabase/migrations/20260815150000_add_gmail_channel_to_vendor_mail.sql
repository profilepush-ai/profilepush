-- Adds an optional Gmail channel to the existing (Mailgun-only) vendor mail inbox.
-- A conversation's channel is fixed by whichever way its first message was sent —
-- Gmail/Mailgun threading can't be mixed mid-conversation — so channel lives on both
-- vendor_conversations (the whole thread) and vendor_messages (each message, since
-- inbound replies synced from Gmail are recorded the same way regardless).

ALTER TABLE public.vendor_conversations
  ADD COLUMN channel text NOT NULL DEFAULT 'mailgun' CHECK (channel IN ('mailgun', 'gmail')),
  ADD COLUMN gmail_thread_id text;

ALTER TABLE public.vendor_messages
  ADD COLUMN channel text NOT NULL DEFAULT 'mailgun' CHECK (channel IN ('mailgun', 'gmail')),
  ADD COLUMN gmail_message_id text,
  ADD COLUMN gmail_history_id bigint;

CREATE UNIQUE INDEX vendor_conversations_gmail_thread_id_idx
  ON public.vendor_conversations (gmail_thread_id) WHERE gmail_thread_id IS NOT NULL;

CREATE UNIQUE INDEX vendor_messages_gmail_message_id_idx
  ON public.vendor_messages (gmail_message_id) WHERE gmail_message_id IS NOT NULL;

CREATE INDEX vendor_conversations_gmail_sync_idx
  ON public.vendor_conversations (last_message_at)
  WHERE channel = 'gmail' AND status NOT IN ('closed', 'failed') AND gmail_thread_id IS NOT NULL;

COMMENT ON COLUMN public.vendor_conversations.channel IS
  'Locked on the first message of the conversation. mailgun sends from requests@ask.profilepush.ai; gmail sends from the user''s own connected address.';
COMMENT ON COLUMN public.vendor_conversations.gmail_thread_id IS
  'Gmail API threadId, set on the first Gmail-channel send; used by gmail-sync to poll this specific thread only.';
COMMENT ON COLUMN public.vendor_messages.gmail_message_id IS
  'Gmail API message id, analogous to mailgun_message_id.';
COMMENT ON COLUMN public.vendor_messages.gmail_history_id IS
  'Gmail historyId at time of fetch; reserved for a future incremental-sync optimization, unused in v1 (which polls threads.get in full).';
