import { buildSupabaseFunctionHeaders, supabase } from './supabase';
import { getBillingErrorMessage, openRazorpayCheckout } from './billing-plan';
import { WEBSITE_PLAN } from './website-plan';

// Website plan status and checkout, for signed-in pages. Kept apart from
// website-plan.ts so the public /websites page doesn't load Razorpay code.

export type WebsitePlanStatus = { expiresAt: string | null; active: boolean };

export async function fetchMyWebsitePlan(): Promise<WebsitePlanStatus> {
  const { data, error } = await supabase.rpc('get_my_website_plan' as never);
  if (error) throw error;
  const row = (data as unknown as { expires_at: string | null; active: boolean }[] | null)?.[0];
  return { expiresAt: row?.expires_at ?? null, active: row?.active ?? false };
}

export type WebsiteCheckoutResult = {
  paymentId: string;
  confirmed: boolean;
  planExpiresAt: string | null;
  balance: number | null;
};

// Opens Razorpay for the yearly website plan. Resolves with the result once
// paid (null if the buyer closes the checkout). Confirms the payment with us
// right away so the plan and credits land now; the webhook would apply it
// too, but only once either way.
export async function startWebsiteCheckout(prefill: { name?: string; email?: string }): Promise<WebsiteCheckoutResult | null> {
  const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
  const { data, error } = await supabase.functions.invoke('razorpay-create-website-order', { body: {}, headers: headers as Record<string, string> });
  if (error || !data?.order_id) {
    let serverPayload: unknown = data;
    try { serverPayload = await (error as { context?: Response } | null)?.context?.json?.(); } catch { /* keep data */ }
    throw new Error(getBillingErrorMessage(error ?? data?.error, 'Failed to start checkout', serverPayload));
  }

  return new Promise((resolve, reject) => {
    openRazorpayCheckout({
      key: data.key_id,
      order_id: data.order_id,
      amount: data.amount_inr_paise,
      currency: 'INR',
      name: 'ProfilePush',
      description: `Website plan, 1 year + ${WEBSITE_PLAN.bonusCreditsLabel} credits`,
      image: '/favicon.svg',
      prefill,
      theme: { color: '#2563eb' },
      handler: async (response: Record<string, unknown>) => {
        const result: WebsiteCheckoutResult = {
          paymentId: String(response.razorpay_payment_id ?? ''),
          confirmed: false,
          planExpiresAt: null,
          balance: null,
        };
        try {
          const verifyHeaders = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
          const { data: verified, error: verifyError } = await supabase.functions.invoke('razorpay-verify-website-payment', {
            body: {
              razorpay_order_id: response.razorpay_order_id ?? data.order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            },
            headers: verifyHeaders as Record<string, string>,
          });
          if (!verifyError && verified && !verified.error) {
            result.confirmed = true;
            result.planExpiresAt = verified.plan_expires_at ?? null;
            const balance = Number(verified.balance ?? NaN);
            result.balance = Number.isFinite(balance) ? balance : null;
          }
        } catch {
          // Falls back to the webhook; the page says so.
        }
        resolve(result);
      },
      onDismiss: () => resolve(null),
    }).catch(reject);
  });
}
