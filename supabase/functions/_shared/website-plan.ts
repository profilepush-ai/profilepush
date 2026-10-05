// Website Modernization plans, each charged as a one-time Razorpay Order.
// Prices are all inclusive (GST included). Must match WEBSITE_PLANS in
// src/lib/website-plan.ts (what the pages show).
export type WebsitePlanId = "website" | "live" | "live_upgrade";

export const WEBSITE_PLANS: Record<WebsitePlanId, { paise: number; credits: number; termMonths: number; label: string }> = {
  website: { paise: 9999 * 100, credits: 1000, termMonths: 12, label: "Website plan, 1 year" },
  live: { paise: 19999 * 100, credits: 3000, termMonths: 12, label: "Live Website plan, 1 year" },
  // Website → Live for the rest of the current term (no extra time).
  live_upgrade: { paise: 10000 * 100, credits: 2000, termMonths: 0, label: "Upgrade to Live Website" },
};

export const isWebsitePlanId = (v: unknown): v is WebsitePlanId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(WEBSITE_PLANS, v);
