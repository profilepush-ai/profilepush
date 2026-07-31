import { describe, expect, it } from 'vitest';
import { getBillingErrorMessage } from './billing-plan';

describe('getBillingErrorMessage', () => {
  it('prefers the server error payload when present', () => {
    expect(getBillingErrorMessage({ message: 'Edge Function returned a non-2xx status code' }, 'Failed to change plan', 'No active subscription found')).toBe('No active subscription found');
  });

  it('falls back to the supplied default when no details are available', () => {
    expect(getBillingErrorMessage({ message: 'Edge Function returned a non-2xx status code' }, 'Failed to change plan')).toBe('Failed to change plan');
  });
});
