-- Signups were failing to create a workspace at all.
--
-- grant_trial_credits ran BEFORE INSERT on accounts and, in the same function,
-- inserted a credit_transactions row referencing NEW.id. At BEFORE INSERT the
-- accounts row does not exist yet, so credit_transactions_account_id_fkey
-- fails and takes the whole accounts INSERT down with it:
--
--   409  POST /rest/v1/accounts
--   23503  Key (account_id)=(…) is not present in table "accounts"
--
-- The signup page inserts accounts and account_members from the client, one
-- after the other, and only surfaces an error for the second. So the user saw
-- no error, landed in the app with no active membership, and could not post,
-- switch persona, or even read their own rows — the RLS policies need an
-- active membership to read a membership. Reproduced on three separate fresh
-- signups through the live form.
--
-- The fix splits the work by timing, which is what it always needed:
--   * BEFORE INSERT stamps the row itself (credits_balance must be set on NEW
--     for it to be part of the inserted row).
--   * AFTER INSERT writes the ledger entry, once the row it references exists.

create or replace function public.grant_trial_credits()
returns trigger
language plpgsql
security definer
as $$
begin
  new.credits_balance := 100;
  new.free_credits_granted_at := now();
  return new;
end;
$$;

create or replace function public.log_trial_credit_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- on conflict: the signup grant shares the milestone unique index, so a
  -- retried insert cannot double-log.
  insert into public.credit_transactions (account_id, type, amount, description, milestone_key)
  values (new.id, 'grant', coalesce(new.credits_balance, 100), 'Free signup credits', 'signup')
  on conflict (account_id, milestone_key) where milestone_key is not null
  do nothing;
  return null;
end;
$$;

drop trigger if exists trg_grant_trial_credits on public.accounts;
create trigger trg_grant_trial_credits
  before insert on public.accounts
  for each row execute function public.grant_trial_credits();

drop trigger if exists trg_log_trial_credit_grant on public.accounts;
create trigger trg_log_trial_credit_grant
  after insert on public.accounts
  for each row execute function public.log_trial_credit_grant();

-- Backfill: accounts whose signup grant never reached the ledger because the
-- insert that would have written it is the one that failed. Balances are left
-- alone — this only records what was granted.
insert into public.credit_transactions (account_id, type, amount, description, milestone_key)
select a.id, 'grant', coalesce(a.credits_balance, 0), 'Free signup credits', 'signup'
from public.accounts a
where a.free_credits_granted_at is not null
  and coalesce(a.credits_balance, 0) > 0
  and not exists (
    select 1 from public.credit_transactions ct
    where ct.account_id = a.id and ct.milestone_key = 'signup'
  )
on conflict (account_id, milestone_key) where milestone_key is not null
do nothing;
