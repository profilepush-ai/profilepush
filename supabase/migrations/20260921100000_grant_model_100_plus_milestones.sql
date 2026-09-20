-- Signup grant becomes 100 credits, with two 50-credit milestones earned back.
--
-- 500 free credits is ~50 AI Match runs: at a run or two a day a user never
-- reaches the end of it, so there is no moment where paying is a decision. 100
-- is ~10 full runs — a bench of 3-5 consultants matched twice over, plus a
-- dozen submissions — which is enough to judge the product and little enough
-- to finish. Rematches only charge for genuinely new matches, so a careful
-- user stretches it much further than ten runs.
--
-- The milestones pay out for the two behaviours that predict retention:
-- posting inventory, and actually submitting someone. Both are granted once
-- per account, ever.
--
-- Existing accounts are untouched: this changes the trigger for new rows, not
-- any balance already issued.

alter table public.credit_transactions
  add column if not exists milestone_key text;

-- One payout per milestone per account. A partial unique index rather than a
-- table constraint so the column stays null for every ordinary transaction.
create unique index if not exists idx_credit_transactions_account_milestone
  on public.credit_transactions (account_id, milestone_key)
  where milestone_key is not null;

-- Idempotent by construction: the insert races against the unique index, and
-- the balance only moves when this call is the one that won.
create or replace function public.grant_milestone_credits(
  p_account_id uuid,
  p_milestone text,
  p_amount numeric,
  p_description text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_account_id is null or coalesce(btrim(p_milestone), '') = '' or coalesce(p_amount, 0) <= 0 then
    return false;
  end if;

  insert into public.credit_transactions (account_id, type, amount, description, milestone_key)
  values (p_account_id, 'grant', p_amount, p_description, p_milestone)
  on conflict (account_id, milestone_key) where milestone_key is not null
  do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  update public.accounts
  set credits_balance = coalesce(credits_balance, 0) + p_amount
  where id = p_account_id;

  return true;
end;
$$;

revoke all on function public.grant_milestone_credits(uuid, text, numeric, text) from public, anon;
grant execute on function public.grant_milestone_credits(uuid, text, numeric, text) to service_role;

-- 500 -> 100 for new signups.
create or replace function public.grant_trial_credits()
returns trigger
language plpgsql
security definer
as $$
begin
  new.credits_balance := 100;
  new.free_credits_granted_at := now();
  insert into public.credit_transactions (account_id, type, amount, description, milestone_key)
  values (new.id, 'grant', 100, 'Free signup credits', 'signup');
  return new;
end;
$$;

alter table public.accounts alter column credits_balance set default 100;

-- Milestone 1: first post of their own, either kind. Fired from the row rather
-- than from the create RPCs so every path that inserts a user post counts,
-- including the batch one AI Match uses for a bulk hotlist.
create or replace function public.grant_first_post_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.grant_milestone_credits(
    new.created_by_account_id,
    'first_post',
    50,
    'Bonus: first post published'
  );
  return new;
end;
$$;

-- The WHEN clause matters: social_jobs takes ~900 scraped rows a day and none
-- of them should even enter the function.
drop trigger if exists trg_grant_first_post_credits on public.social_hotlist;
create trigger trg_grant_first_post_credits
  after insert on public.social_hotlist
  for each row
  when (new.post_source = 'user_post' and new.created_by_account_id is not null)
  execute function public.grant_first_post_credits();

drop trigger if exists trg_grant_first_post_credits on public.social_jobs;
create trigger trg_grant_first_post_credits
  after insert on public.social_jobs
  for each row
  when (new.post_source = 'user_post' and new.created_by_account_id is not null)
  execute function public.grant_first_post_credits();

-- Milestone 2: first consultant actually submitted to a job.
create or replace function public.grant_first_submission_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.grant_milestone_credits(
    new.created_by_account_id,
    'first_submission',
    50,
    'Bonus: first submission sent'
  );
  return new;
end;
$$;

drop trigger if exists trg_grant_first_submission_credits on public.job_applications;
create trigger trg_grant_first_submission_credits
  after insert on public.job_applications
  for each row execute function public.grant_first_submission_credits();

-- Lets the app show "50 credits for your first post" only while it is unearned.
create or replace function public.get_earned_milestones()
returns table (milestone_key text, amount numeric, earned_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select ct.milestone_key, ct.amount, ct.created_at
  from public.credit_transactions ct
  join public.account_members am
    on am.account_id = ct.account_id
   and am.user_id = auth.uid()
   and am.status = 'active'
  where ct.milestone_key is not null;
$$;

revoke all on function public.get_earned_milestones() from public, anon;
grant execute on function public.get_earned_milestones() to authenticated;
