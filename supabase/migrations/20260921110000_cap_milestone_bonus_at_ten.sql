-- Milestone bonuses drop from 50 to 10 credits each.
--
-- 10 credits is exactly one AI Match run, which is the point: "post a
-- consultant, get a free run" is a legible trade, where 50 was a third of the
-- signup grant again and quietly undid the scarcity the 100-credit grant was
-- meant to create. Two milestones means a new account can reach 120 at most.
--
-- The ceiling is enforced in grant_milestone_credits rather than only at the
-- call sites, so no future trigger can hand out more by passing a larger
-- number.

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
  v_amount numeric;
begin
  if p_account_id is null or coalesce(btrim(p_milestone), '') = '' or coalesce(p_amount, 0) <= 0 then
    return false;
  end if;

  -- Hard ceiling on any single bonus, wherever it is called from.
  v_amount := least(p_amount, 10);

  insert into public.credit_transactions (account_id, type, amount, description, milestone_key)
  values (p_account_id, 'grant', v_amount, p_description, p_milestone)
  on conflict (account_id, milestone_key) where milestone_key is not null
  do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  update public.accounts
  set credits_balance = coalesce(credits_balance, 0) + v_amount
  where id = p_account_id;

  return true;
end;
$$;

-- The call sites pass 10 now too, so the ledger description and the amount
-- agree without relying on the clamp.
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
    10,
    'Bonus: first post published'
  );
  return new;
end;
$$;

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
    10,
    'Bonus: first submission sent'
  );
  return new;
end;
$$;
