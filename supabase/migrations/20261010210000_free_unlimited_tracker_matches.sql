/*
# Tracker matches: free and unlimited

charge_tracker_match charged 1 credit for every match card the matcher added
and stopped at 10 a day (30 paid). Credits drained with nobody acting, and
the cap made more than a handful of fresh matches a day impossible. Matches
are now free and unlimited; credits are spent only when the user acts (a
send, an AI Match run, a draft). The trigger keeps one job: not counting a
duplicate card.
*/
create or replace function public.charge_tracker_match()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.stage is distinct from 'new' then return new; end if;
  -- A duplicate is dropped by ON CONFLICT anyway; skip it here.
  if exists (select 1 from public.pipeline_cards c where c.subject_id = new.subject_id and c.lead_id = new.lead_id) then
    return null;
  end if;
  return new;
end;
$$;
