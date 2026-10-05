-- Website Modernization plan: ₹29,999 a year, all inclusive, paid as a
-- one-time Razorpay Order (like credit packs, no subscription). Each paid
-- order extends the account's website plan by 12 months and adds 5,000
-- ProfilePush credits.
--
-- razorpay-create-website-order writes the pending row; whichever of
-- razorpay-verify-website-payment (the checkout's own confirmation), the
-- webhook or a later reconcile gets there first applies it, exactly once.

alter table public.accounts
  add column if not exists website_plan_expires_at timestamptz;

create table if not exists public.website_plan_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  razorpay_order_id text unique not null,
  razorpay_payment_id text,
  amount_inr_paise integer not null check (amount_inr_paise > 0),
  bonus_credits integer not null default 0 check (bonus_credits >= 0),
  term_months integer not null default 12 check (term_months > 0),
  status text not null default 'created' check (status in ('created', 'paid', 'failed')),
  plan_expires_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists website_plan_orders_account_idx on public.website_plan_orders (account_id, created_at desc);

alter table public.website_plan_orders enable row level security;
revoke all on public.website_plan_orders from public, anon, authenticated;
grant all on public.website_plan_orders to service_role;

-- Marks the order paid, extends the plan (from today, or from the current
-- expiry if the plan is still running, so renewing early loses nothing) and
-- adds the bonus credits. The status update is the lock: a second call for
-- the same order changes nothing and returns applied = false.
create or replace function public.apply_website_plan_order(p_razorpay_order_id text, p_razorpay_payment_id text)
returns table (applied boolean, account_id uuid, plan_expires_at timestamptz, credits integer, new_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_order public.website_plan_orders%rowtype;
  v_expires timestamptz;
  v_balance numeric;
begin
  update public.website_plan_orders o
  set status = 'paid', razorpay_payment_id = p_razorpay_payment_id, paid_at = now()
  where o.razorpay_order_id = p_razorpay_order_id and o.status = 'created'
  returning o.* into v_order;

  if not found then
    select o.* into v_order from public.website_plan_orders o where o.razorpay_order_id = p_razorpay_order_id;
    select a.credits_balance into v_balance from public.accounts a where a.id = v_order.account_id;
    return query select false, v_order.account_id, v_order.plan_expires_at, v_order.bonus_credits, v_balance;
    return;
  end if;

  update public.accounts a
  set website_plan_expires_at = greatest(coalesce(a.website_plan_expires_at, now()), now()) + make_interval(months => v_order.term_months),
      credits_balance = coalesce(a.credits_balance, 0) + v_order.bonus_credits,
      is_trial = false
  where a.id = v_order.account_id
  returning a.website_plan_expires_at, a.credits_balance into v_expires, v_balance;

  update public.website_plan_orders o set plan_expires_at = v_expires where o.id = v_order.id;

  if v_order.bonus_credits > 0 then
    insert into public.credit_transactions (account_id, user_id, type, amount, description)
    values (
      v_order.account_id, v_order.user_id, 'grant', v_order.bonus_credits,
      'Website plan: ' || v_order.bonus_credits || ' credits included (₹'
        || (v_order.amount_inr_paise / 100) || ', ' || coalesce(p_razorpay_payment_id, 'payment') || ')'
    );
  end if;

  return query select true, v_order.account_id, v_expires, v_order.bonus_credits, v_balance;
end;
$$;

revoke all on function public.apply_website_plan_order(text, text) from public, anon, authenticated;
grant execute on function public.apply_website_plan_order(text, text) to service_role;

-- The signed-in user's website plan: when it ends (null if never bought).
create or replace function public.get_my_website_plan()
returns table (expires_at timestamptz, active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select a.website_plan_expires_at, coalesce(a.website_plan_expires_at > now(), false)
  from public.accounts a
  where a.id = public.publisher_account_for_user(auth.uid())
$$;

revoke all on function public.get_my_website_plan() from public, anon;
grant execute on function public.get_my_website_plan() to authenticated;

-- A website plan is a payment too: the account gets the paid allowances
-- (unlimited open posts, the bigger Network allowance).
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
  ) or exists (
    select 1 from public.website_plan_orders w
    where w.account_id = p_account_id and w.status = 'paid'
  );
$$;

revoke all on function public.account_has_paid(uuid) from public, anon, authenticated;
grant execute on function public.account_has_paid(uuid) to service_role;
