-- Two faults introduced earlier today, both visible in new users' ledgers.
--
-- 1. Duplicate signup grant.
--
-- A migration on 2026-08-22 had already split the trial grant into a BEFORE
-- trigger that stamps the balance and an AFTER trigger, trg_log_trial_credits_grant,
-- that writes the ledger row for 500. Today's grant-model migration recreated
-- grant_trial_credits with the ledger insert back inside the BEFORE function
-- (which re-broke signup with an FK violation), and the later fix added a
-- second AFTER trigger under a slightly different name —
-- trg_log_trial_credit_grant, singular. Both then fired, so every account
-- created since has two "Free signup credits" rows: one for 100, one for 500.
--
-- The balance itself was always right (the BEFORE trigger sets it to 100 and
-- ledger rows do not move balances on their own), but the ledger claimed 600
-- was granted. Left alone, every credits report would be wrong.
--
-- 2. The first AI Match run paid for itself.
--
-- A run charges 10 credits and then publishes what was pasted as the user's
-- own post — and that post awarded the 10-credit "first post published"
-- bonus. Net zero. Three users this afternoon ran AI Match and watched their
-- balance not move, which is exactly what was reported. The bonus is meant to
-- reward posting inventory deliberately, not to refund the feature that
-- happens to post on the user's behalf.

-- ── 1. one signup grant trigger, not two ──────────────────────────────────
drop trigger if exists trg_log_trial_credits_grant on public.accounts;
drop function if exists public.log_trial_credits_grant();

-- Remove the phantom 500 rows. Only rows that sit alongside a correct
-- milestone-tagged grant for the same account are touched, so genuine 500
-- grants from before today are left exactly as they are.
delete from public.credit_transactions ct
where ct.description = 'Free signup credits'
  and ct.milestone_key is null
  and ct.amount = 500
  and ct.created_at >= date '2026-09-21'
  and exists (
    select 1 from public.credit_transactions keep
    where keep.account_id = ct.account_id
      and keep.milestone_key = 'signup'
  );

-- ── 2. AI Match's own post must not trigger the first-post bonus ──────────
create or replace function public.grant_first_post_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_match_run boolean;
begin
  -- AI Match publishes the pasted text as a post immediately after charging
  -- for the run. Without this check the bonus refunds the run, and the user
  -- sees their balance stand still after using a paid feature.
  --
  -- Matched on a short window against the charge rather than on a column,
  -- because the auto-post goes through the same create_user_*_post RPCs a
  -- manual post does and is indistinguishable from one at the row level.
  select exists (
    select 1
    from public.credit_transactions ct
    where ct.account_id = new.created_by_account_id
      and ct.type = 'usage'
      and ct.description like '%ai_match_run%'
      and ct.created_at > now() - interval '2 minutes'
  ) into v_recent_match_run;

  if v_recent_match_run then
    return new;
  end if;

  perform public.grant_milestone_credits(
    new.created_by_account_id,
    'first_post',
    10,
    'Bonus: first post published'
  );
  return new;
end;
$$;
