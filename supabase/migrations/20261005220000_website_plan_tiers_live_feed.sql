-- Website Modernization: two yearly plans, and the live portal.
--
--   website  ₹9,999   one-page site, forms, admin            + 1,000 credits
--   live     ₹19,999  + live portal of current ProfilePush   + 3,000 credits
--                      job posts and hotlist on the site
--   live_upgrade ₹10,000  website → live for the rest of the term (+2,000 credits)
--
-- accounts.website_plan holds the tier; website_plan_expires_at the end date.

alter table public.accounts
  add column if not exists website_plan text check (website_plan in ('website', 'live'));

alter table public.website_plan_orders
  add column if not exists plan text not null default 'website' check (plan in ('website', 'live', 'live_upgrade'));

-- Accounts that bought before tiers existed got the full product.
update public.accounts set website_plan = 'live'
where website_plan is null and website_plan_expires_at is not null;

-- Applies a paid order once. An upgrade keeps the current end date; a new
-- plan or renewal adds its term from today or the current end date.
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

  if v_order.plan = 'live_upgrade' then
    update public.accounts a
    set website_plan = 'live',
        credits_balance = coalesce(a.credits_balance, 0) + v_order.bonus_credits,
        is_trial = false
    where a.id = v_order.account_id
    returning a.website_plan_expires_at, a.credits_balance into v_expires, v_balance;
  else
    update public.accounts a
    set website_plan_expires_at = greatest(coalesce(a.website_plan_expires_at, now()), now()) + make_interval(months => v_order.term_months),
        website_plan = v_order.plan,
        credits_balance = coalesce(a.credits_balance, 0) + v_order.bonus_credits,
        is_trial = false
    where a.id = v_order.account_id
    returning a.website_plan_expires_at, a.credits_balance into v_expires, v_balance;
  end if;

  update public.website_plan_orders o set plan_expires_at = v_expires where o.id = v_order.id;

  if v_order.website_id is not null then
    perform public.attach_website_to_account(v_order.website_id, v_order.account_id);
  end if;

  if v_order.bonus_credits > 0 then
    insert into public.credit_transactions (account_id, user_id, type, amount, description)
    values (
      v_order.account_id, v_order.user_id, 'grant', v_order.bonus_credits,
      case v_order.plan when 'live' then 'Live Website plan' when 'live_upgrade' then 'Upgrade to Live Website' else 'Website plan' end
        || ': ' || v_order.bonus_credits || ' credits included (₹' || (v_order.amount_inr_paise / 100) || ', '
        || coalesce(p_razorpay_payment_id, 'payment') || ')'
    );
  end if;

  return query select true, v_order.account_id, v_expires, v_order.bonus_credits, v_balance;
end;
$$;

revoke all on function public.apply_website_plan_order(text, text) from public, anon, authenticated;
grant execute on function public.apply_website_plan_order(text, text) to service_role;

-- The signed-in user's plan: when it ends, whether it's running, and the tier.
drop function if exists public.get_my_website_plan();
create function public.get_my_website_plan()
returns table (expires_at timestamptz, active boolean, plan text)
language sql
stable
security definer
set search_path = public
as $$
  select a.website_plan_expires_at, coalesce(a.website_plan_expires_at > now(), false), a.website_plan
  from public.accounts a
  where a.id = public.publisher_account_for_user(auth.uid())
$$;

revoke all on function public.get_my_website_plan() from public, anon;
grant execute on function public.get_my_website_plan() to authenticated;

-- Live portal feed for one website (website-host Worker, service role).
--   live:    claimed, Live plan running → the account's own open posts
--   preview: unclaimed demo → recent posts from the firm's email domain,
--            so the demo shows what Live would look like
--   off:     anything else
-- Only role-level fields: never names, contact details, rates or clients.
create or replace function public.website_live_feed(p_website_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_site public.websites%rowtype;
  v_live boolean := false;
  v_mode text := 'off';
  v_since timestamptz := now() - interval '45 days';
  v_jobs jsonb;
  v_hot jsonb;
begin
  select * into v_site from public.websites w where w.id = p_website_id;
  if not found then return jsonb_build_object('mode', 'off'); end if;

  if v_site.account_id is not null then
    select (a.website_plan = 'live' and a.website_plan_expires_at > now()) into v_live
    from public.accounts a where a.id = v_site.account_id;
    if coalesce(v_live, false) then v_mode := 'live'; end if;
  elsif v_site.claim_domain is not null then
    v_mode := 'preview';
  end if;

  if v_mode = 'off' then return jsonb_build_object('mode', 'off'); end if;

  select coalesce(jsonb_agg(j order by j->>'posted_at' desc), '[]'::jsonb) into v_jobs from (
    select jsonb_build_object(
      'id', s.id, 'title', s.job_title, 'location', s.location, 'type', s.employment_type,
      'skills', to_jsonb(s.extracted_skills), 'experience', s.extracted_experience_years,
      'posted_at', coalesce(s.posted_at, s.created_at)
    ) j
    from public.social_jobs s
    where s.hidden_at is null
      and coalesce(s.post_status, 'open') = 'open'
      and coalesce(s.posted_at, s.created_at) > v_since
      and s.job_title is not null
      and (case when v_mode = 'live'
                then s.created_by_account_id = v_site.account_id
                else lower(split_part(s.poster_email, '@', 2)) = v_site.claim_domain end)
    order by coalesce(s.posted_at, s.created_at) desc
    limit 30
  ) x;

  select coalesce(jsonb_agg(h order by h->>'posted_at' desc), '[]'::jsonb) into v_hot from (
    select jsonb_build_object(
      'id', s.id, 'title', s.role_title, 'skills', to_jsonb(s.core_skills), 'experience', s.years_experience,
      'visa', s.visa_type, 'work_type', s.work_type, 'locations', to_jsonb(s.locations),
      'availability', s.availability, 'posted_at', coalesce(s.posted_at, s.created_at)
    ) h
    from public.social_hotlist s
    where s.hidden_at is null
      and coalesce(s.post_status, 'open') = 'open'
      and coalesce(s.posted_at, s.created_at) > v_since
      and s.role_title is not null
      and (case when v_mode = 'live'
                then s.created_by_account_id = v_site.account_id
                else lower(split_part(s.bench_sales_recruiter_email, '@', 2)) = v_site.claim_domain end)
    order by coalesce(s.posted_at, s.created_at) desc
    limit 30
  ) x;

  return jsonb_build_object('mode', v_mode, 'jobs', v_jobs, 'hotlist', v_hot);
end;
$$;

revoke all on function public.website_live_feed(uuid) from public, anon, authenticated;
grant execute on function public.website_live_feed(uuid) to service_role;
