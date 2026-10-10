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

// One-time top-up packs: a ₹249 starter pack, then the same tiers as the
// subscription plans. Subscriptions don't offer 249.
export const CREDIT_PACKS = [249, ...CREDIT_TIERS] as const;

export function isValidCreditPack(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && (CREDIT_PACKS as readonly number[]).includes(value);
}

// Packs the first-purchase offer doubles.
export const FIRST_PURCHASE_OFFER_PACKS: readonly number[] = [249, 250, 500];

// One-time top-ups are any whole-rupee amount at ₹0.25 a match: 1 credit is
// 1 match, so every rupee buys 4 credits.
export const CREDITS_PER_RUPEE = 4;
export const MIN_TOPUP_INR = 100;
export const MAX_TOPUP_INR = 100_000;

export function isValidTopupAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_TOPUP_INR && value <= MAX_TOPUP_INR;
}
