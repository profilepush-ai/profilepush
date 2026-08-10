ALTER TABLE public.vendor_messages
  ADD COLUMN display_text text,
  ADD COLUMN display_text_status text
    CHECK (display_text_status IN ('pending', 'processing', 'complete', 'failed'));

UPDATE public.vendor_messages
SET display_text_status = 'pending'
WHERE direction = 'inbound';

COMMENT ON COLUMN public.vendor_messages.display_text IS
  'AI-sanitized inbound message text for user display; raw email remains in text_body.';

COMMENT ON COLUMN public.vendor_messages.display_text_status IS
  'Processing state for AI sanitization of inbound vendor messages.';