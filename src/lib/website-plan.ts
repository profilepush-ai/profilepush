// Website Modernization plan: one all-inclusive yearly price (GST included) for a rebuilt website, its
// hosting and admin portal, plus ProfilePush credits granted on purchase.
// The checkout (Razorpay order) must charge the same amount — keep this in
// step with the edge function that creates the order.
export const WEBSITE_PLAN = {
  priceInr: 36999,
  priceLabel: '₹36,999',
  termMonths: 12,
  bonusCredits: 5000,
  bonusCreditsLabel: '5,000',
} as const;
