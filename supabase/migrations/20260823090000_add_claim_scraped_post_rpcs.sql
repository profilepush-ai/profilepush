-- Lets a signed-in user claim webhook-scraped posts (post_source='linkedin_scrape')
-- that carry their own verified email, converting them into 'user_post' rows they
-- own. This makes MyPostsPage.tsx's existing loadPosts() query
-- (.eq('created_by_account_id', account.id).eq('post_source','user_post')) pick
-- them up automatically — no changes needed there — and it also means
-- update_user_job_post/delete_user_job_post (which gate on
-- post_source='user_post' AND created_by_account_id=v_account_id) work on a
-- claimed post afterward without any changes either.
--
-- Scoped to the last 30 days (COALESCE(posted_at, created_at), matching this
-- codebase's existing "effective post date" convention from
-- 20260811140000_create_social_hotlist_pipeline.sql) and to the caller's own
-- auth.users.email — never a client-supplied email, since that's the entire
-- security boundary preventing claiming someone else's post.
--
-- No credit charge and no rate limit, mirroring delete_user_job_post/
-- delete_user_hotlist_post's precedent for non-charging write RPCs — claiming
-- is self-limited by how many scraped rows exist for one person's email in the
-- window.
--
-- verification_status (job-only column) is deliberately left untouched: it has
-- its own unrelated meaning (ask-AI fulfillment, see 20260809182000) and
-- self-created posts already default to 'unverified', so a claimed post
-- staying 'unverified' is consistent, not a regression.

-- Plain (non-functional) indexes, not lower()-expression ones, because the
-- frontend discovery query filters with a plain `.eq()` against an
-- already-lowercased value (both columns are lowercased at ingestion) — a
-- lower(...) expression index like the existing idx_social_hotlist_recruiter_email
-- can't be used by a plain `col = value` predicate.
CREATE INDEX IF NOT EXISTS idx_social_jobs_poster_email
  ON public.social_jobs (poster_email)
  WHERE poster_email <> '';

CREATE INDEX IF NOT EXISTS idx_social_hotlist_recruiter_email_plain
  ON public.social_hotlist (bench_sales_recruiter_email)
  WHERE bench_sales_recruiter_email <> '';


CREATE OR REPLACE FUNCTION public.claim_scraped_job_post(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_email text;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT am.account_id INTO v_account_id
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account membership found';
  END IF;

  v_email := lower(trim(COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'No verified email on this account';
  END IF;

  UPDATE public.social_jobs
  SET
    post_source = 'user_post',
    created_by_account_id = v_account_id,
    created_by_user_id = auth.uid(),
    updated_at = now()
  WHERE id = p_id
    AND post_source = 'linkedin_scrape'
    AND created_by_account_id IS NULL
    AND hidden_at IS NULL
    AND lower(trim(poster_email)) = v_email
    AND COALESCE(posted_at, created_at) >= now() - interval '30 days';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'This post is no longer available to claim';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scraped_job_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_scraped_job_post(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.claim_scraped_hotlist_post(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_email text;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT am.account_id INTO v_account_id
    FROM public.account_members am
    WHERE am.user_id = auth.uid() AND am.status = 'active'
    ORDER BY am.created_at ASC
    LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account membership found';
  END IF;

  v_email := lower(trim(COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'No verified email on this account';
  END IF;

  UPDATE public.social_hotlist
  SET
    post_source = 'user_post',
    created_by_account_id = v_account_id,
    created_by_user_id = auth.uid(),
    updated_at = now()
  WHERE id = p_id
    AND post_source = 'linkedin_scrape'
    AND created_by_account_id IS NULL
    AND hidden_at IS NULL
    AND lower(trim(bench_sales_recruiter_email)) = v_email
    AND COALESCE(posted_at, created_at) >= now() - interval '30 days';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'This post is no longer available to claim';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scraped_hotlist_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_scraped_hotlist_post(uuid) TO authenticated;
