-- Per-post in-app chat for platform-native (user_post) Job/Hotlist posts.
-- The existing vendor_conversations/vendor_messages tables model a one-way
-- "platform user -> external vendor email" outreach flow (single owning
-- account per row, the other party is only a free-text name/email, heavy
-- Mailgun/Gmail threading columns, and a send path that physically emails
-- people) — none of that fits pure in-app chat between two platform
-- accounts, so this is a new, small, dedicated schema instead.
--
-- A thread is (post x interested account): the post owner ends up with one
-- thread per account that opened a conversation about their post.

CREATE TABLE public.post_chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_kind text NOT NULL CHECK (post_kind IN ('job', 'hotlist')),
  job_id uuid REFERENCES public.social_jobs(id) ON DELETE CASCADE,
  hotlist_id uuid REFERENCES public.social_hotlist(id) ON DELETE CASCADE,
  owner_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_display_name text NOT NULL DEFAULT '',
  participant_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  participant_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  participant_display_name text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  owner_unread_count integer NOT NULL DEFAULT 0 CHECK (owner_unread_count >= 0),
  participant_unread_count integer NOT NULL DEFAULT 0 CHECK (participant_unread_count >= 0),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_chat_threads_kind_target_check CHECK (
    (post_kind = 'job' AND job_id IS NOT NULL AND hotlist_id IS NULL)
    OR (post_kind = 'hotlist' AND hotlist_id IS NOT NULL AND job_id IS NULL)
  ),
  CONSTRAINT post_chat_threads_distinct_accounts_check CHECK (owner_account_id <> participant_account_id)
);

CREATE UNIQUE INDEX idx_post_chat_threads_job_participant
  ON public.post_chat_threads (job_id, participant_account_id)
  WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX idx_post_chat_threads_hotlist_participant
  ON public.post_chat_threads (hotlist_id, participant_account_id)
  WHERE hotlist_id IS NOT NULL;
CREATE INDEX idx_post_chat_threads_owner_account ON public.post_chat_threads (owner_account_id, last_message_at DESC);
CREATE INDEX idx_post_chat_threads_participant_account ON public.post_chat_threads (participant_account_id, last_message_at DESC);

CREATE TABLE public.post_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.post_chat_threads(id) ON DELETE CASCADE,
  sender_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_display_name text NOT NULL DEFAULT '',
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_post_chat_messages_thread_created ON public.post_chat_messages (thread_id, created_at);

ALTER TABLE public.post_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_chat_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.post_chat_threads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.post_chat_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.post_chat_threads TO authenticated;
GRANT SELECT ON public.post_chat_messages TO authenticated;
GRANT ALL ON public.post_chat_threads TO service_role;
GRANT ALL ON public.post_chat_messages TO service_role;

CREATE POLICY select_own_post_chat_threads
  ON public.post_chat_threads FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.user_id = auth.uid()
        AND am.status = 'active'
        AND am.account_id IN (post_chat_threads.owner_account_id, post_chat_threads.participant_account_id)
    )
  );

CREATE POLICY select_own_post_chat_messages
  ON public.post_chat_messages FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.post_chat_threads t
      JOIN public.account_members am ON am.user_id = auth.uid() AND am.status = 'active'
        AND am.account_id IN (t.owner_account_id, t.participant_account_id)
      WHERE t.id = post_chat_messages.thread_id
    )
  );

-- Writes go exclusively through the SECURITY DEFINER RPCs in
-- 20260819140000_add_post_chat_rpcs.sql, never direct client inserts.

ALTER PUBLICATION supabase_realtime ADD TABLE public.post_chat_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.post_chat_messages;
