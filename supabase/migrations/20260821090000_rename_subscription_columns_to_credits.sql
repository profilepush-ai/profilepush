-- Reactivating the dormant subscription flow as a real recurring Pro plan
-- (500-5000 credits/month, flat ₹1/credit, same ratio as the one-time
-- top-up packs). The old columns were named/used as if plan_amount_usd
-- were a real US-dollar price converted to INR via INR_PER_USD=100 — that
-- conversion no longer applies now that credits_balance is a plain
-- integer credit count, not a USD wallet. Renaming (not just reinterpreting)
-- so the column name itself can't mislead future readers. Only 1 test row
-- exists in `subscriptions`, 0 active — safe to rename directly.

ALTER TABLE public.subscriptions RENAME COLUMN plan_amount_usd TO plan_credits;
ALTER TABLE public.subscriptions RENAME COLUMN pending_plan_amount_usd TO pending_plan_credits;
ALTER TABLE public.subscriptions ALTER COLUMN plan_credits SET DEFAULT 500;

ALTER TABLE public.razorpay_plan_cache RENAME COLUMN amount_usd TO plan_credits;

ALTER TABLE public.razorpay_upgrade_orders RENAME COLUMN old_plan_amount_usd TO old_plan_credits;
ALTER TABLE public.razorpay_upgrade_orders RENAME COLUMN new_plan_amount_usd TO new_plan_credits;
ALTER TABLE public.razorpay_upgrade_orders RENAME COLUMN proration_usd TO proration_credits;
