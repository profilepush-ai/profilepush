// Website Modernization plans: yearly, all inclusive (GST included), with
// ProfilePush credits granted on purchase. The checkout (Razorpay order) must
// charge the same amounts — keep these in step with WEBSITE_PLANS in
// supabase/functions/_shared/website-plan.ts.
export type WebsitePlanTier = 'website' | 'live';

export const WEBSITE_PLANS: Record<WebsitePlanTier, {
  id: WebsitePlanTier; name: string; priceInr: number; priceLabel: string; credits: number; creditsLabel: string;
  summary: string; features: string[];
}> = {
  website: {
    id: 'website',
    name: 'Website',
    priceInr: 9999,
    priceLabel: '₹9,999',
    credits: 1000,
    creditsLabel: '1,000',
    summary: 'Your rebuilt one-page site, its enquiry forms and the admin.',
    features: [
      'Modern one-page website, rebuilt from your content',
      'Enquiry forms for your goals, with résumé uploads',
      'Admin: enquiries, analytics, CSV export',
      'Email alerts and a daily analytics email',
      'Hosting, HTTPS and your own domain',
    ],
  },
  live: {
    id: 'live',
    name: 'Live Website',
    priceInr: 19999,
    priceLabel: '₹19,999',
    credits: 3000,
    creditsLabel: '3,000',
    summary: 'Everything in Website, plus a live portal that keeps itself current.',
    features: [
      'Everything in Website',
      'Live portal: your current ProfilePush job posts on your site',
      'Live bench: your hotlist consultants, updated automatically',
      'Never goes stale; nothing to update by hand',
    ],
  },
};

// Website → Live for the rest of the current term.
export const LIVE_UPGRADE = { priceInr: 10000, priceLabel: '₹10,000', credits: 2000, creditsLabel: '2,000' } as const;
