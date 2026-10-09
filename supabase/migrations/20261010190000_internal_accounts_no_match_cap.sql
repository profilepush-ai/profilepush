/*
# Internal accounts: Tracker matches without charge or daily cap

charge_tracker_match charges 1 credit per new card and stops at 10 a day (30
paid). Internal test accounts are now exempt so they can quality-check
matching at full volume.
*/
CREATE OR REPLACE FUNCTION public.charge_tracker_match()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance numeric;
  v_used integer;
  v_cap integer;
begin
  if new.stage is distinct from 'new' then return new; end if;

  -- Internal (test) accounts: matched without charge or daily cap.
  if public.pp_is_internal_account(new.account_id) then
    if exists (select 1 from public.pipeline_cards c where c.subject_id = new.subject_id and c.lead_id = new.lead_id) then return null; end if;
    return new;
  end if;

  -- Lock the account so concurrent inserts can't both spend the last credit.
  select a.credits_balance into v_balance from public.accounts a where a.id = new.account_id for update;
  if coalesce(v_balance, 0) < 1 then return null; end if;

  v_cap := case when public.account_has_paid(new.account_id) then 30 else 10 end;
  select u.used into v_used from public.tracker_match_usage u
  where u.account_id = new.account_id and u.day = current_date;
  if coalesce(v_used, 0) >= v_cap then return null; end if;

  -- A duplicate would be dropped by ON CONFLICT after this trigger has run;
  -- don't charge for it.
  if exists (select 1 from public.pipeline_cards c where c.subject_id = new.subject_id and c.lead_id = new.lead_id) then
    return null;
  end if;

  update public.accounts set credits_balance = round(coalesce(credits_balance, 0) - 1, 4) where id = new.account_id;
  insert into public.credit_transactions (account_id, user_id, type, amount, description)
  values (new.account_id, null, 'usage', -1, 'Usage: tracker_auto_match');
  insert into public.tracker_match_usage (account_id, day, used)
  values (new.account_id, current_date, 1)
  on conflict (account_id, day) do update set used = tracker_match_usage.used + 1;
  return new;
end;
$function$;
