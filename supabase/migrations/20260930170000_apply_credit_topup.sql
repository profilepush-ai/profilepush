-- Credit top-ups, fixed.
--
-- The payment.captured webhook looked the order up by notes.order_id, but the
-- order's notes never carry its own id (Razorpay assigns it after the notes
-- are set), so no top-up was ever credited. Crediting now goes through this
-- one function, called by the webhook (with the payment's real order_id), by
-- the checkout's own verification right after payment, and by the admin
-- reconcile. It flips the order from 'created' to 'paid' and adds the credits
-- in one statement, so whichever caller arrives first credits it and the
-- others find nothing to do — never twice.
alter table public.credit_topup_orders
  add column if not exists razorpay_payment_id text,
  add column if not exists paid_at timestamptz;

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
begin
  update public.credit_topup_orders o
  set status = 'paid', razorpay_payment_id = p_razorpay_payment_id, paid_at = now()
  where o.razorpay_order_id = p_razorpay_order_id and o.status = 'created'
  returning o.* into v_order;

  if not found then
    select o.* into v_order from public.credit_topup_orders o where o.razorpay_order_id = p_razorpay_order_id;
    select a.credits_balance into v_balance from public.accounts a where a.id = v_order.account_id;
    return query select false, v_order.account_id, v_order.credits, v_balance;
    return;
  end if;

  update public.accounts a
  set credits_balance = coalesce(a.credits_balance, 0) + v_order.credits, is_trial = false
  where a.id = v_order.account_id
  returning a.credits_balance into v_balance;

  insert into public.credit_transactions (account_id, user_id, type, amount, description)
  values (
    v_order.account_id, v_order.user_id, 'topup', v_order.credits,
    'Credit top-up: ' || v_order.credits || ' credits (₹' || (v_order.amount_inr_paise / 100) || ', ' || coalesce(p_razorpay_payment_id, 'payment') || ')'
  );

  return query select true, v_order.account_id, v_order.credits, v_balance;
end;
$$;

revoke all on function public.apply_credit_topup(text, text) from public, anon, authenticated;
grant execute on function public.apply_credit_topup(text, text) to service_role;

-- Purchase history for the Billing page: the account's own top-ups.
create or replace function public.get_my_credit_purchases()
returns table (razorpay_order_id text, razorpay_payment_id text, credits integer, amount_inr_paise integer, status text, created_at timestamptz, paid_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.razorpay_order_id, o.razorpay_payment_id, o.credits, o.amount_inr_paise, o.status, o.created_at, o.paid_at
  from public.credit_topup_orders o
  where o.account_id = public.publisher_account_for_user(auth.uid())
    and o.status = 'paid'
  order by coalesce(o.paid_at, o.created_at) desc
  limit 100
$$;

revoke all on function public.get_my_credit_purchases() from public, anon;
grant execute on function public.get_my_credit_purchases() to authenticated;
