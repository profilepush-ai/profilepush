-- First-purchase offer: double credits for one hour.
--
-- An account that has never paid and has under 50 credits gets the offer the
-- first time it opens the app. The hour starts then, is stored here (so a
-- reload can't restart it), and each account gets the offer once, ever. A
-- credit order created while the offer is live carries bonus_credits equal
-- to its credits, and apply_credit_topup adds the bonus once, on the first
-- paid order, marking the offer used.

create table if not exists public.first_purchase_offers (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.first_purchase_offers enable row level security;
revoke all on public.first_purchase_offers from public, anon, authenticated;
grant select, insert, update on public.first_purchase_offers to service_role;

alter table public.credit_topup_orders
  add column if not exists bonus_credits integer not null default 0;

-- Has this account ever paid us: a paid credit pack, or a subscription that
-- was ever charged.
create or replace function public.account_has_paid(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.credit_topup_orders o
    where o.account_id = p_account_id and o.status = 'paid'
  ) or exists (
    select 1 from public.subscriptions s
    where s.account_id = p_account_id
      and (s.status = 'active' or s.current_period_start is not null)
  );
$$;

-- The signed-in user's live offer, if any: when it ends. Starts the hour the
-- first time an eligible account asks.
create or replace function public.get_my_first_purchase_offer()
returns table (expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account_id uuid := public.publisher_account_for_user(auth.uid());
  v_offer public.first_purchase_offers%rowtype;
  v_balance numeric;
begin
  if v_account_id is null then return; end if;

  select * into v_offer from public.first_purchase_offers o where o.account_id = v_account_id;
  if found then
    if v_offer.used_at is null and v_offer.expires_at > now() and not public.account_has_paid(v_account_id) then
      return query select v_offer.expires_at;
    end if;
    return;
  end if;

  select a.credits_balance into v_balance from public.accounts a where a.id = v_account_id;
  if coalesce(v_balance, 0) >= 50 or public.account_has_paid(v_account_id) then return; end if;

  insert into public.first_purchase_offers (account_id, started_at, expires_at)
  values (v_account_id, now(), now() + interval '1 hour')
  on conflict (account_id) do nothing;

  return query select o.expires_at from public.first_purchase_offers o
    where o.account_id = v_account_id and o.used_at is null and o.expires_at > now();
end;
$$;

revoke all on function public.get_my_first_purchase_offer() from public, anon;
grant execute on function public.get_my_first_purchase_offer() to authenticated;

-- For razorpay-create-credit-order: is the account's offer live right now?
create or replace function public.first_purchase_offer_active(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.first_purchase_offers o
    where o.account_id = p_account_id and o.used_at is null and o.expires_at > now()
  ) and not public.account_has_paid(p_account_id);
$$;

revoke all on function public.account_has_paid(uuid) from public, anon, authenticated;
revoke all on function public.first_purchase_offer_active(uuid) from public, anon, authenticated;
grant execute on function public.account_has_paid(uuid) to service_role;
grant execute on function public.first_purchase_offer_active(uuid) to service_role;

-- Same as before, plus the offer bonus: added only if this payment is the one
-- that uses the offer (the update on first_purchase_offers is the lock, so two
-- orders paid in the same hour can't both get it). credits in the result is
-- what was added, bonus included.
create or replace function public.apply_credit_topup(p_razorpay_order_id text, p_razorpay_payment_id text)
returns table (credited boolean, account_id uuid, credits integer, new_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_order public.credit_topup_orders%rowtype;
  v_balance numeric;
  v_bonus integer := 0;
begin
  update public.credit_topup_orders o
  set status = 'paid', razorpay_payment_id = p_razorpay_payment_id, paid_at = now()
  where o.razorpay_order_id = p_razorpay_order_id and o.status = 'created'
  returning o.* into v_order;

  if not found then
    select o.* into v_order from public.credit_topup_orders o where o.razorpay_order_id = p_razorpay_order_id;
    select a.credits_balance into v_balance from public.accounts a where a.id = v_order.account_id;
    return query select false, v_order.account_id, v_order.credits + coalesce(v_order.bonus_credits, 0), v_balance;
    return;
  end if;

  if coalesce(v_order.bonus_credits, 0) > 0 then
    update public.first_purchase_offers f
    set used_at = now()
    where f.account_id = v_order.account_id and f.used_at is null;
    if found then
      v_bonus := v_order.bonus_credits;
    else
      -- Another order already used the offer: this one is a normal top-up.
      update public.credit_topup_orders o set bonus_credits = 0 where o.id = v_order.id;
    end if;
  end if;

  update public.accounts a
  set credits_balance = coalesce(a.credits_balance, 0) + v_order.credits + v_bonus, is_trial = false
  where a.id = v_order.account_id
  returning a.credits_balance into v_balance;

  insert into public.credit_transactions (account_id, user_id, type, amount, description)
  values (
    v_order.account_id, v_order.user_id, 'topup', v_order.credits + v_bonus,
    'Credit top-up: ' || v_order.credits || ' credits'
      || case when v_bonus > 0 then ' + ' || v_bonus || ' first-purchase bonus' else '' end
      || ' (₹' || (v_order.amount_inr_paise / 100) || ', ' || coalesce(p_razorpay_payment_id, 'payment') || ')'
  );

  return query select true, v_order.account_id, v_order.credits + v_bonus, v_balance;
end;
$$;

revoke all on function public.apply_credit_topup(text, text) from public, anon, authenticated;
grant execute on function public.apply_credit_topup(text, text) to service_role;

-- Purchase history shows what each purchase added, bonus included.
create or replace function public.get_my_credit_purchases()
returns table (razorpay_order_id text, razorpay_payment_id text, credits integer, amount_inr_paise integer, status text, created_at timestamptz, paid_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.razorpay_order_id, o.razorpay_payment_id, o.credits + coalesce(o.bonus_credits, 0), o.amount_inr_paise, o.status, o.created_at, o.paid_at
  from public.credit_topup_orders o
  where o.account_id = public.publisher_account_for_user(auth.uid())
    and o.status = 'paid'
  order by coalesce(o.paid_at, o.created_at) desc
  limit 100
$$;

revoke all on function public.get_my_credit_purchases() from public, anon;
grant execute on function public.get_my_credit_purchases() to authenticated;
