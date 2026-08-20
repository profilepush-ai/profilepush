-- Schema for user-submitted Job/Hotlist posts, merged alongside the scraped
-- LinkedIn feed. RLS on both tables is left exactly as-is (SELECT-only for
-- authenticated, per 20260816110000's deliberate lockdown) — all writes to
-- these new columns happen exclusively through the SECURITY DEFINER RPCs
-- added in 20260819110000, never direct client inserts.
--
-- created_by_account_id is a NEW column rather than reusing social_jobs'
-- existing `account_id` — that one is set opportunistically by the scrape
-- webhook ("if included") and carries no authorship meaning; overloading it
-- would corrupt "my posts" queries against real user-submitted rows.

ALTER TABLE public.social_jobs
  ADD COLUMN IF NOT EXISTS post_source text NOT NULL DEFAULT 'linkedin_scrape',
  ADD COLUMN IF NOT EXISTS created_by_account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS post_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.social_jobs
  DROP CONSTRAINT IF EXISTS social_jobs_post_source_check;
ALTER TABLE public.social_jobs
  ADD CONSTRAINT social_jobs_post_source_check CHECK (post_source IN ('linkedin_scrape', 'user_post'));

ALTER TABLE public.social_jobs
  DROP CONSTRAINT IF EXISTS social_jobs_post_status_check;
ALTER TABLE public.social_jobs
  ADD CONSTRAINT social_jobs_post_status_check CHECK (post_status IN ('open', 'closed'));

CREATE INDEX IF NOT EXISTS idx_social_jobs_created_by_account
  ON public.social_jobs (created_by_account_id, created_at DESC)
  WHERE created_by_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_jobs_user_post
  ON public.social_jobs (post_source)
  WHERE post_source = 'user_post';

ALTER TABLE public.social_hotlist
  ADD COLUMN IF NOT EXISTS post_source text NOT NULL DEFAULT 'linkedin_scrape',
  ADD COLUMN IF NOT EXISTS created_by_account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS post_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.social_hotlist
  DROP CONSTRAINT IF EXISTS social_hotlist_post_source_check;
ALTER TABLE public.social_hotlist
  ADD CONSTRAINT social_hotlist_post_source_check CHECK (post_source IN ('linkedin_scrape', 'user_post'));

ALTER TABLE public.social_hotlist
  DROP CONSTRAINT IF EXISTS social_hotlist_post_status_check;
ALTER TABLE public.social_hotlist
  ADD CONSTRAINT social_hotlist_post_status_check CHECK (post_status IN ('open', 'closed'));

CREATE INDEX IF NOT EXISTS idx_social_hotlist_created_by_account
  ON public.social_hotlist (created_by_account_id, created_at DESC)
  WHERE created_by_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_hotlist_user_post
  ON public.social_hotlist (post_source)
  WHERE post_source = 'user_post';
