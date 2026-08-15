-- Allows the new "preview post" paid action (1c) to persist per-account/user state
-- in pulse_lead_actions, matching the existing 'revealed'/'breakdown' pattern.

ALTER TABLE public.pulse_lead_actions
  DROP CONSTRAINT IF EXISTS pulse_lead_actions_action_type_check;

ALTER TABLE public.pulse_lead_actions
  ADD CONSTRAINT pulse_lead_actions_action_type_check
  CHECK (action_type IN ('revealed', 'breakdown', 'post_content_viewed'));
