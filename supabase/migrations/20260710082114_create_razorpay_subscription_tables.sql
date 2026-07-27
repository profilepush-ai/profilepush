-- Subscriptions (one per account, tracks Razorpay recurring plan)
CREATE TABLE subscriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  razorpay_subscription_id text UNIQUE,
  razorpay_plan_id        text,
  plan_amount_usd         integer NOT NULL DEFAULT 25,
  status                  text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('pending','active','halted','cancelled','completed','inactive')),
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  pending_plan_amount_usd integer,        -- scheduled downgrade, applied at next renewal
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_select_subscription" ON subscriptions FOR SELECT
  TO authenticated USING (
    account_id IN (
      SELECT account_id FROM account_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "service_all_subscriptions" ON subscriptions FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Razorpay plan ID cache (keyed by amount_usd so we reuse plans)
CREATE TABLE razorpay_plan_cache (
  amount_usd          integer PRIMARY KEY,
  razorpay_plan_id    text NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE razorpay_plan_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_plan_cache" ON razorpay_plan_cache FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- One-time upgrade orders (prorated upgrade charges)
CREATE TABLE razorpay_upgrade_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  razorpay_order_id    text UNIQUE,
  old_plan_amount_usd  integer NOT NULL,
  new_plan_amount_usd  integer NOT NULL,
  proration_usd        numeric NOT NULL,
  status               text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','paid','failed')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE razorpay_upgrade_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_select_upgrade_orders" ON razorpay_upgrade_orders FOR SELECT
  TO authenticated USING (
    account_id IN (
      SELECT account_id FROM account_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "service_all_upgrade_orders" ON razorpay_upgrade_orders FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Index for webhook lookups
CREATE INDEX idx_subscriptions_rzp_id ON subscriptions (razorpay_subscription_id);
CREATE INDEX idx_upgrade_orders_rzp_id ON razorpay_upgrade_orders (razorpay_order_id);
