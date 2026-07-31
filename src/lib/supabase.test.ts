import { describe, expect, it } from 'vitest';
import { buildSupabaseFunctionHeaders } from './supabase';

describe('buildSupabaseFunctionHeaders', () => {
  it('returns an Authorization header when a session token exists', async () => {
    const headers = await buildSupabaseFunctionHeaders(async () => ({
      data: { session: { access_token: 'abc123' } },
    } as any));

    expect(headers).toEqual({ Authorization: 'Bearer abc123' });
  });

  it('returns no auth header when no session is present', async () => {
    const headers = await buildSupabaseFunctionHeaders(async () => ({
      data: { session: null },
    } as any));

    expect(headers).toEqual({});
  });
});
