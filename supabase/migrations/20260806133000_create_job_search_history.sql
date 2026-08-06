CREATE TABLE IF NOT EXISTS public.job_search_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page text NOT NULL DEFAULT '/jobs',
  search_query text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_search_history_user_page_created
  ON public.job_search_history (user_id, page, created_at DESC);

ALTER TABLE public.job_search_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'job_search_history'
      AND policyname = 'select_own_job_search_history'
  ) THEN
    CREATE POLICY select_own_job_search_history
      ON public.job_search_history
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'job_search_history'
      AND policyname = 'insert_own_job_search_history'
  ) THEN
    CREATE POLICY insert_own_job_search_history
      ON public.job_search_history
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
