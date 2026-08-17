-- Logs every AI-generated vendor/recruiter email (Jobs "Send Email" / Hotlist
-- "Request"), independent of vendor_conversations/vendor_messages which only
-- ever get rows once an email is actually sent. Since the UI no longer sends
-- emails directly (Gmail Sync isn't wired up yet), this is what lets the
-- Inbox show every generated email, not just ones that were sent. Kept as its
-- own table rather than reusing vendor_conversations to avoid entangling with
-- the send/delivery/credit-refund pipeline (Mailgun webhooks, request_id FK,
-- etc.) that table is built around.
CREATE TABLE public.pulse_ask_ai_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.social_jobs(id) ON DELETE CASCADE,
  hotlist_id uuid REFERENCES public.social_hotlist(id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  vendor_email text NOT NULL,
  subject text NOT NULL,
  email_content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((job_id IS NOT NULL) <> (hotlist_id IS NOT NULL))
);

-- One preview per (user, lead) — regenerating for the same lead refreshes the
-- existing row (via upsert) instead of cluttering the inbox with duplicates.
CREATE UNIQUE INDEX pulse_ask_ai_previews_user_job_idx
  ON public.pulse_ask_ai_previews (user_id, job_id) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX pulse_ask_ai_previews_user_hotlist_idx
  ON public.pulse_ask_ai_previews (user_id, hotlist_id) WHERE hotlist_id IS NOT NULL;
CREATE INDEX pulse_ask_ai_previews_user_updated_idx
  ON public.pulse_ask_ai_previews (user_id, updated_at DESC);

ALTER TABLE public.pulse_ask_ai_previews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pulse_ask_ai_previews FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.pulse_ask_ai_previews TO authenticated;
GRANT ALL ON public.pulse_ask_ai_previews TO service_role;

CREATE POLICY select_own_pulse_ask_ai_previews
  ON public.pulse_ask_ai_previews FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY insert_own_pulse_ask_ai_previews
  ON public.pulse_ask_ai_previews FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.account_members
      WHERE account_members.account_id = pulse_ask_ai_previews.account_id
        AND account_members.user_id = auth.uid()
        AND account_members.status = 'active'
    )
  );

CREATE POLICY update_own_pulse_ask_ai_previews
  ON public.pulse_ask_ai_previews FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.pulse_ask_ai_previews;
