-- Tracker matches cost credits: 1 credit per match card, as AI Match does.
-- The matcher does the matching (and the alerts that follow it) for the
-- user, so it draws on the same balance. Most accounts were sitting on
-- 90-100 of their 100 signup credits; this spends them on matches the user
-- actually sees, which is the point of the grant.
--
-- Capped per account per UTC day: 10 matches on the free plan, 30 once the
-- account has paid (account_has_paid: any credit pack). Past the cap, or
-- with less than 1 credit left, no more cards are added that day; nothing
-- already on the board is touched or charged retroactively.
--
-- Enforced by a trigger on pipeline_cards, so every insert path obeys it:
-- the 10-minute matcher, the sparse-column top-up and the column's Rematch.
-- A skipped card is simply not inserted, so the tracker alert (which counts
-- inserted cards) never announces a match the user didn't get.

create table if not exists public.tracker_match_usage (
  account_id uuid not null references public.accounts(id) on delete cascade,
  day date not null,
  used integer not null default 0,
  primary key (account_id, day)
);
alter table public.tracker_match_usage enable row level security;
revoke all on public.tracker_match_usage from public, anon, authenticated;

create or replace function public.charge_tracker_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_used integer;
  v_cap integer;
begin
  if new.stage is distinct from 'new' then return new; end if;

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
$$;
revoke all on function public.charge_tracker_match() from public, anon, authenticated;

drop trigger if exists pipeline_cards_charge_match on public.pipeline_cards;
create trigger pipeline_cards_charge_match
  before insert on public.pipeline_cards
  for each row execute function public.charge_tracker_match();
