ALTER TABLE public.pulse_ask_ai_requests
  ADD COLUMN IF NOT EXISTS delivery_http_status integer,
  ADD COLUMN IF NOT EXISTS delivery_response text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

COMMENT ON COLUMN public.pulse_ask_ai_requests.delivery_response IS
  'Truncated response body returned by the outbound CRM webhook; service-role only.';