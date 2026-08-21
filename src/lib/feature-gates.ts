import type { Subscription } from '../contexts/AuthContext';

// Paywall disabled 2026-08-19 so the platform runs free "for now". Nothing
// downstream of this flag is deleted — accounts.credits_balance,
// credit_transactions, subscriptions, Razorpay edge functions, and
// BillingPage all stay in place. Flip this back to true to re-enable every
// gate that reads it below.
export const BILLING_GATES_ENABLED = false;

export function isPaidPlanEffective(subscription: Subscription | null | undefined): boolean {
  if (!BILLING_GATES_ENABLED) return true;
  return subscription?.status === 'active' && (subscription.plan_credits ?? 0) > 0;
}

export function shouldChargeCredits(): boolean {
  return BILLING_GATES_ENABLED;
}

// Decoupled from BILLING_GATES_ENABLED: the credits balance UI is live for
// the new 500-free / 1-credit-per-action model (email drafts, chat drafts,
// post creation) independent of the legacy paid-plan gates above, which
// stay disabled.
export function shouldShowCreditsUi(): boolean {
  return true;
}
