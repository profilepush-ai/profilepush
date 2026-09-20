-- Put every free account on the new 100-credit grant.
--
-- The grant dropped from 500 to 100, but existing accounts kept their old
-- balances — several are sitting on hundreds of credits and will not reach a
-- paying decision for months. This levels them onto the same footing as a new
-- signup.
--
-- Who is excluded, and why it matters:
--   * anyone who has ever topped up — those credits were bought, and both the
--     Terms and the Pricing page promise top-ups never expire. Taking them
--     back would break a written promise to the only people currently paying.
--   * anyone with a live subscription (pending/active/halted) — same reason;
--     halted is included because the subscription still exists and can resume.
--
-- Every change writes a ledger row carrying the exact delta, so this is
-- auditable and reversible: undoing it means applying the inverse of each
-- 'account_rebalance_100' transaction.

do $$
declare
  v_raised integer := 0;
  v_reduced integer := 0;
begin
  with eligible as (
    select a.id, coalesce(a.credits_balance, 0) as balance
    from public.accounts a
    where not exists (
      select 1 from public.credit_transactions ct
      where ct.account_id = a.id and ct.type = 'topup'
    )
    and not exists (
      select 1 from public.subscriptions s
      where s.account_id = a.id and s.status in ('pending', 'active', 'halted')
    )
    and coalesce(a.credits_balance, 0) <> 100
  ),
  ledger as (
    insert into public.credit_transactions (account_id, type, amount, description, milestone_key)
    select
      id,
      -- The check constraint allows grant/topup/usage/refund; a reduction is
      -- recorded as usage with a negative amount, which is how every other
      -- deduction in this table is written.
      case when 100 - balance > 0 then 'grant' else 'usage' end,
      100 - balance,
      'Balance reset to the 100-credit free grant',
      'account_rebalance_100'
    from eligible
    returning account_id, amount
  ),
  applied as (
    update public.accounts a
    set credits_balance = 100
    from eligible e
    where a.id = e.id
    returning a.id
  )
  select
    count(*) filter (where amount > 0),
    count(*) filter (where amount < 0)
  into v_raised, v_reduced
  from ledger;

  raise notice 'Rebalanced to 100: % raised, % reduced', v_raised, v_reduced;
end;
$$;
