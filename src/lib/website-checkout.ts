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
// With a claimToken, the payment also claims that demo website.
export async function startWebsiteCheckout(prefill: { name?: string; email?: string }, claimToken?: string): Promise<WebsiteCheckoutResult | null> {
  const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
  const { data, error } = await supabase.functions.invoke('razorpay-create-website-order', { body: claimToken ? { claim_token: claimToken } : {}, headers: headers as Record<string, string> });
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

export type ClaimableWebsite = {
  name: string;
  slug: string;
  source_url: string | null;
  claimed: boolean;
  expired: boolean;
  claim_domain: string | null;
};

export async function fetchClaimableWebsite(token: string): Promise<ClaimableWebsite | null> {
  const { data, error } = await supabase.rpc('get_claimable_website' as never, { p_token: token } as never);
  if (error) throw error;
  return (data as unknown as ClaimableWebsite[] | null)?.[0] ?? null;
}

// For an account whose plan is already running and has no site yet.
export async function claimWithActivePlan(token: string): Promise<void> {
  const { error } = await supabase.rpc('claim_website_with_active_plan' as never, { p_token: token } as never);
  if (error) throw new Error(error.message);
}

export const WEBSITE_HOST_URL = 'https://profilepush-website-host.profilepush-ai.workers.dev';
// Set once the sites domain is routed to the website-host Worker.
export const SITES_DOMAIN = '';

export function websiteUrl(site: { slug: string; custom_domain?: string | null }): string {
  if (site.custom_domain) return `https://${site.custom_domain}/`;
  return SITES_DOMAIN ? `https://${site.slug}.${SITES_DOMAIN}/` : `${WEBSITE_HOST_URL}/s/${site.slug}/`;
}

export type MyWebsite = {
  id: string;
  slug: string;
  name: string;
  status: string;
  custom_domain: string | null;
  claimed_at: string | null;
};

export async function fetchMyWebsites(): Promise<MyWebsite[]> {
  const { data, error } = await supabase
    .from('websites' as never)
    .select('id, slug, name, status, custom_domain, claimed_at')
    .order('claimed_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as MyWebsite[];
}

export type WebsiteSubmission = {
  id: string;
  created_at: string;
  website_id: string;
  kind: 'candidate' | 'partner' | 'contact';
  name: string | null;
  email: string | null;
  phone: string | null;
  data: Record<string, string>;
  resume_path: string | null;
  resume_filename: string | null;
  status: 'new' | 'contacted' | 'closed';
};

export async function fetchSubmissions(websiteId: string): Promise<WebsiteSubmission[]> {
  const { data, error } = await supabase
    .from('website_submissions' as never)
    .select('id, created_at, website_id, kind, name, email, phone, data, resume_path, resume_filename, status')
    .eq('website_id', websiteId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as WebsiteSubmission[];
}

export async function setSubmissionStatus(id: string, status: WebsiteSubmission['status']): Promise<void> {
  const { error } = await supabase.from('website_submissions' as never).update({ status } as never).eq('id', id);
  if (error) throw error;
}

export async function resumeDownloadUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('website-resumes').createSignedUrl(path, 300, { download: true });
  if (error || !data?.signedUrl) throw error ?? new Error('Could not open the résumé');
  return data.signedUrl;
}

export function submissionsCsv(rows: WebsiteSubmission[]): string {
  const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r.data ?? {}))));
  const header = ['received', 'type', 'status', 'name', 'email', 'phone', ...keys, 'resume'];
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    // Visitors write these values: stop Excel/Sheets reading them as formulas.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map(r => [
    r.created_at, r.kind, r.status, r.name, r.email, r.phone,
    ...keys.map(k => r.data?.[k] ?? ''),
    r.resume_filename ?? '',
  ].map(cell).join(','));
  return [header.map(cell).join(','), ...lines].join('\n');
}
