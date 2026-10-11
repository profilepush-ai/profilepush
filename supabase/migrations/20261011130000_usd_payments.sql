/*
# Paying in dollars

Outside India people pay in US dollars: $0.01 a match (100 credits a
dollar), any whole-dollar amount from $5. In India it stays rupees (₹0.25 a
match, from ₹100). Credits are the same everywhere; only the price differs.
Razorpay International takes the card; payouts settle in rupees.

- credit_topup_orders.currency and amount_minor: what was charged, in paise
  or cents. amount_inr_paise stays the rupee figure for revenue reports; for
  a dollar order it's an estimate at ₹85 a dollar.
- accounts.billing_currency: the currency they last paid in, so labels (the
  extension's AI Apply price) quote in it.
*/

alter table public.credit_topup_orders add column if not exists currency text not null default 'INR';
alter table public.credit_topup_orders drop constraint if exists credit_topup_orders_currency_check;
alter table public.credit_topup_orders add constraint credit_topup_orders_currency_check check (currency in ('INR', 'USD'));
alter table public.credit_topup_orders add column if not exists amount_minor integer;
update public.credit_topup_orders set amount_minor = amount_inr_paise where amount_minor is null and currency = 'INR';

alter table public.accounts add column if not exists billing_currency text;
alter table public.accounts drop constraint if exists accounts_billing_currency_check;
alter table public.accounts add constraint accounts_billing_currency_check check (billing_currency in ('INR', 'USD'));

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
      || ' (' || case when v_order.currency = 'USD' then '$' || to_char(coalesce(v_order.amount_minor, 0) / 100.0, 'FM999999990.00') else '₹' || (coalesce(v_order.amount_minor, v_order.amount_inr_paise) / 100) end
      || ', ' || coalesce(p_razorpay_payment_id, 'payment') || ')'
  );

  return query select true, v_order.account_id, v_order.credits + v_bonus, v_balance;
end;
$$;
revoke all on function public.apply_credit_topup(text, text) from public, anon, authenticated;
grant execute on function public.apply_credit_topup(text, text) to service_role;

-- Purchase history in the currency each purchase was paid in.
drop function if exists public.get_my_credit_purchases();
create function public.get_my_credit_purchases()
returns table (razorpay_order_id text, razorpay_payment_id text, credits integer, amount_inr_paise integer, currency text, amount_minor integer, status text, created_at timestamptz, paid_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.razorpay_order_id, o.razorpay_payment_id, o.credits + coalesce(o.bonus_credits, 0), o.amount_inr_paise,
    o.currency, coalesce(o.amount_minor, o.amount_inr_paise), o.status, o.created_at, o.paid_at
  from public.credit_topup_orders o
  where o.account_id = public.publisher_account_for_user(auth.uid())
    and o.status = 'paid'
  order by coalesce(o.paid_at, o.created_at) desc
  limit 100
$$;
revoke all on function public.get_my_credit_purchases() from public, anon;
grant execute on function public.get_my_credit_purchases() to authenticated;
