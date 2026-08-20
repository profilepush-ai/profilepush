import { describe, expect, it } from 'vitest';
import { BILLING_GATES_ENABLED, isPaidPlanEffective, shouldChargeCredits, shouldShowCreditsUi } from './feature-gates';
import type { Subscription } from '../contexts/AuthContext';

describe('feature-gates', () => {
  it('keeps billing gates disabled', () => {
    expect(BILLING_GATES_ENABLED).toBe(false);
  });

  it('shouldChargeCredits mirrors the disabled flag', () => {
    expect(shouldChargeCredits()).toBe(false);
  });

  it('shouldShowCreditsUi mirrors the disabled flag', () => {
    expect(shouldShowCreditsUi()).toBe(false);
  });

  it('treats every account as paid while gates are disabled, even with no subscription', () => {
    expect(isPaidPlanEffective(null)).toBe(true);
    expect(isPaidPlanEffective(undefined)).toBe(true);

    const inactiveSub = { status: 'inactive', plan_amount_usd: 0 } as Subscription;
    expect(isPaidPlanEffective(inactiveSub)).toBe(true);
  });
});
