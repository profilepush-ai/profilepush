-- Per-user Gmail OAuth integration: lets a user connect their own Gmail account so
-- vendor outreach/replies can be sent from their real address instead of the shared
-- requests@ask.profilepush.ai Mailgun sender. Tokens are only ever read/written by
-- service-role edge functions; the table itself is never exposed to authenticated/anon.

CREATE TABLE public.gmail_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  gmail_address text NOT NULL,
  scopes text NOT NULL,
  access_token_encrypted text NOT NULL,
  access_token_iv text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  refresh_token_encrypted text NOT NULL,
  refresh_token_iv text NOT NULL,
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'error', 'revoked')),
  last_error text,
  last_synced_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gmail_integrations_status_idx
  ON public.gmail_integrations (status)
  WHERE status = 'connected';

ALTER TABLE public.gmail_integrations ENABLE ROW LEVEL SECURITY;

-- No policies are created: RLS with zero policies denies all access to
-- authenticated/anon by default, and we additionally revoke table grants so a future
-- misconfigured policy can't accidentally expose the token columns.
REVOKE ALL ON public.gmail_integrations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gmail_integrations TO service_role;

COMMENT ON TABLE public.gmail_integrations IS
  'OAuth tokens for a user''s connected Gmail account. Never grant authenticated/anon access to this table directly — use gmail_integration_status instead.';
COMMENT ON COLUMN public.gmail_integrations.access_token_encrypted IS
  'AES-256-GCM ciphertext, key held only in the GMAIL_TOKEN_ENCRYPTION_KEY edge function secret.';
COMMENT ON COLUMN public.gmail_integrations.refresh_token_encrypted IS
  'AES-256-GCM ciphertext, key held only in the GMAIL_TOKEN_ENCRYPTION_KEY edge function secret.';

-- Token-free view for the Settings UI. Views run with their owner's privileges by
-- default (not security_invoker), so this reads the base table despite authenticated
-- having no direct grant on it — auth.uid() still resolves to the querying user's JWT,
-- so the WHERE clause correctly scopes each caller to their own row. No token columns
-- are selected, so owner-privilege execution never leaks the encrypted tokens.
CREATE VIEW public.gmail_integration_status AS
  SELECT id, user_id, account_id, gmail_address, status, last_error, last_synced_at, connected_at, updated_at
  FROM public.gmail_integrations
  WHERE user_id = auth.uid();

GRANT SELECT ON public.gmail_integration_status TO authenticated;

CREATE FUNCTION public.gmail_integrations_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER gmail_integrations_set_updated_at
BEFORE UPDATE ON public.gmail_integrations
FOR EACH ROW
EXECUTE FUNCTION public.gmail_integrations_set_updated_at();
