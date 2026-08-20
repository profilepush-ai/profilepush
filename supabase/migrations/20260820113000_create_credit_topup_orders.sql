-- Tracks pending/paid one-time Razorpay credit-pack purchases (500-5000
-- credits in 500 increments, ₹1/credit). Separate from razorpay_upgrade_
-- orders, which is shaped for subscription-proration, not a standalone
-- purchase amount.
CREATE TABLE public.credit_topup_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  razorpay_order_id text UNIQUE NOT NULL,
  credits           integer NOT NULL CHECK (credits > 0 AND credits % 500 = 0 AND credits <= 5000),
  amount_inr_paise  integer NOT NULL,
  status            text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX credit_topup_orders_rzp_id_idx ON public.credit_topup_orders (razorpay_order_id);
CREATE INDEX credit_topup_orders_account_idx ON public.credit_topup_orders (account_id, created_at DESC);

ALTER TABLE public.credit_topup_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_select_own_topup_orders" ON public.credit_topup_orders
  FOR SELECT TO authenticated
  USING (account_id IN (
    SELECT account_id FROM public.account_members WHERE user_id = auth.uid() AND status = 'active'
  ));

REVOKE ALL ON public.credit_topup_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.credit_topup_orders TO authenticated;
GRANT ALL ON public.credit_topup_orders TO service_role;
