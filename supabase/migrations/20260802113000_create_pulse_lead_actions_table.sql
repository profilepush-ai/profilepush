CREATE TABLE IF NOT EXISTS public.pulse_lead_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_id text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('revealed', 'breakdown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, lead_id, action_type)
);

CREATE INDEX IF NOT EXISTS idx_pulse_lead_actions_account_action_created
  ON public.pulse_lead_actions (account_id, action_type, created_at DESC);

ALTER TABLE public.pulse_lead_actions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pulse_lead_actions'
      AND policyname = 'select_own_pulse_lead_actions'
  ) THEN
    CREATE POLICY select_own_pulse_lead_actions
      ON public.pulse_lead_actions
      FOR SELECT
      TO authenticated
      USING (
        account_id IN (
          SELECT am.account_id
          FROM public.account_members am
          WHERE am.user_id = auth.uid()
            AND am.status = 'active'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pulse_lead_actions'
      AND policyname = 'insert_own_pulse_lead_actions'
  ) THEN
    CREATE POLICY insert_own_pulse_lead_actions
      ON public.pulse_lead_actions
      FOR INSERT
      TO authenticated
      WITH CHECK (
        account_id IN (
          SELECT am.account_id
          FROM public.account_members am
          WHERE am.user_id = auth.uid()
            AND am.status = 'active'
        )
        AND (user_id IS NULL OR user_id = auth.uid())
      );
  END IF;
END $$;
