-- The Jobs page needs a "Predicted" tab that persists across reloads (mirrors how
-- the "Asked"/"Submitted" tab reads the user's own pulse_ask_ai_requests rows).
-- pulse_predict_logs currently has no read grant for authenticated users at all,
-- so the client can only see predictions made during the current session.
grant select on public.pulse_predict_logs to authenticated;

create policy "predict_logs_select_own" on public.pulse_predict_logs
  for select
  to authenticated
  using (user_id = auth.uid());
