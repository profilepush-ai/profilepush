import { describe, expect, it } from 'vitest';
import { normalizeSocialJobItems } from './social-job-ingestion';

describe('normalizeSocialJobItems', () => {
  it('maps alternate webhook field names into social_jobs rows', () => {
    const items = [
      {
        external_id: 'post-123',
        source: 'linkedin',
        body: 'Senior React Developer role in a high-growth team',
        poster_name: 'Jane Doe',
        poster_email: 'jane@example.com',
        poster_phone: '555-0100',
        post_url: 'https://example.com/post/123',
        title: 'Senior React Developer',
        company: 'Acme Labs',
        location: 'Remote',
        employment_type: 'Full-time',
        posted_at: '2026-08-05T12:00:00.000Z',
        account_id: 'account-001',
      },
    ];

    const result = normalizeSocialJobItems(items);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      post_id: 'post-123',
      platform: 'linkedin',
      post_content: 'Senior React Developer role in a high-growth team',
      job_title: 'Senior React Developer',
      company_name: 'Acme Labs',
      location: 'Remote',
      employment_type: 'Full-time',
      poster_email: 'jane@example.com',
      poster_phone: '555-0100',
      post_url: 'https://example.com/post/123',
      account_id: 'account-001',
    });
    expect(result.rows[0].posted_at).toBe('2026-08-05T12:00:00.000Z');
  });

  it('rejects payloads that do not provide a usable id, platform, or content field', () => {
    const result = normalizeSocialJobItems([{ title: 'Missing fields' }]);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});
