UPDATE public.pulse_lead_actions AS actions
SET user_id = accounts.owner_id
FROM public.accounts AS accounts
WHERE actions.account_id = accounts.id
  AND actions.user_id IS NULL;

ALTER TABLE public.pulse_lead_actions
  ALTER COLUMN user_id SET DEFAULT auth.uid(),
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.pulse_lead_actions
  DROP CONSTRAINT IF EXISTS pulse_lead_actions_account_id_lead_id_action_type_key;

ALTER TABLE public.pulse_lead_actions
  ADD CONSTRAINT pulse_lead_actions_account_user_lead_action_key
  UNIQUE (account_id, user_id, lead_id, action_type);

DROP POLICY IF EXISTS select_own_pulse_lead_actions ON public.pulse_lead_actions;
CREATE POLICY select_own_pulse_lead_actions
  ON public.pulse_lead_actions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND account_id IN (
      SELECT am.account_id
      FROM public.account_members AS am
      WHERE am.user_id = auth.uid()
        AND am.status = 'active'
    )
  );

DROP POLICY IF EXISTS insert_own_pulse_lead_actions ON public.pulse_lead_actions;
CREATE POLICY insert_own_pulse_lead_actions
  ON public.pulse_lead_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND account_id IN (
      SELECT am.account_id
      FROM public.account_members AS am
      WHERE am.user_id = auth.uid()
        AND am.status = 'active'
    )
  );