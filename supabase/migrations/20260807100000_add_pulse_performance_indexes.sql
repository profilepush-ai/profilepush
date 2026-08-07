-- Performance indexes for Pulse feed, leaderboard, and reveal metrics.
-- Targets the exact filter/sort patterns used by Pulse RPCs and UI queries.

CREATE INDEX IF NOT EXISTS idx_radar_match_results_social_job_created
  ON public.radar_match_results (job_source, job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_radar_match_results_social_created
  ON public.radar_match_results (job_source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pulse_lead_actions_action_lead_created
  ON public.pulse_lead_actions (action_type, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_members_account_user
  ON public.account_members (account_id, user_id);

CREATE INDEX IF NOT EXISTS idx_hotlist_ai_roles_target_role_normalized
  ON public.hotlist_ai_roles ((lower(btrim(target_role))));

CREATE INDEX IF NOT EXISTS idx_hotlist_ai_roles_target_role_normalized_updated
  ON public.hotlist_ai_roles ((lower(btrim(target_role))), updated_at DESC);
