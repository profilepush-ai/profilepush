import { describe, expect, it } from 'vitest';
import { buildSignupWebhookPayload } from './auth-webhook';

describe('buildSignupWebhookPayload', () => {
  it('builds a payload with the user identity and provider metadata', () => {
    const payload = buildSignupWebhookPayload({
      action: 'user signed in',
      userId: 'user-123',
      email: 'person@example.com',
      fullName: 'Jane Doe',
      provider: 'google',
    });

    expect(payload).toMatchObject({
      action: 'user signed in',
      user_id: 'user-123',
      email: 'person@example.com',
      full_name: 'Jane Doe',
      auth_provider: 'google',
    });
  });
});
