-- Whether a submission was sent one at a time or from the bulk bar.
--
-- The funnel needs to separate these because they are different decisions:
-- sending one email after reading it is a considered act, sending twenty-five
-- from a bar is a bet on the matching. Until now both wrote an identical row,
-- so the difference was unmeasurable.
--
-- Nullable on purpose. The 143 sends already recorded genuinely have no
-- answer, and defaulting them to 'single' would invent history that reads as
-- fact on a chart. They stay null and the funnel reports them as unattributed.

alter table public.pulse_ask_ai_requests
  add column if not exists send_source text
  check (send_source in ('single', 'bulk'));

comment on column public.pulse_ask_ai_requests.send_source is
  'single | bulk — how the send was triggered. Null for sends made before this column existed.';

create index if not exists pulse_ask_ai_requests_send_source_idx
  on public.pulse_ask_ai_requests (account_id, send_source)
  where send_source is not null;
