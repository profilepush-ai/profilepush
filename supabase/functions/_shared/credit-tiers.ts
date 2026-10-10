// One-time top-ups are any whole-rupee amount at ₹0.25 a match: 1 credit is
// 1 match, so every rupee buys 4 credits. There is no subscription.
export const CREDITS_PER_RUPEE = 4;
export const MIN_TOPUP_INR = 100;
export const MAX_TOPUP_INR = 100_000;

export function isValidTopupAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_TOPUP_INR && value <= MAX_TOPUP_INR;
}

// Amounts the first-purchase offer doubles (₹249 kept for older clients).
export const FIRST_PURCHASE_OFFER_PACKS: readonly number[] = [249, 250, 500];
