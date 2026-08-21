// Shared credit tiers: 500-5000 in 500 increments, flat ₹1/credit. Same
// tier list and pricing ratio for one-time top-up packs
// (razorpay-create-credit-order) and recurring Pro subscription plans
// (razorpay-create-subscription/razorpay-change-plan) — the only
// difference between the two is billing cadence, not price.
export const CREDIT_TIERS = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000] as const;
export const INR_PAISE_PER_CREDIT = 100; // ₹1 = 1 credit

export function isValidCreditTier(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && (CREDIT_TIERS as readonly number[]).includes(value);
}
