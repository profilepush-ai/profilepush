import { describe, expect, it } from 'vitest';
import { normalizeRadarMatchResults } from './radar-results';

describe('normalizeRadarMatchResults', () => {
  it('normalizes radar rows into the Job Watch AI result shape', () => {
    const rows = [
      {
        id: 'match-1',
        profile_id: 'profile-1',
        job_source: 'linkedin',
        job_id: 'job-1',
        final_average_score: 82,
        score_breakdown: {
          role_match: { score: 95, candidate_value: 'Senior React Developer', job_value: 'Senior React Engineer', rule: 'Title match' },
        },
        ai_notes: 'Strong fit',
        disqualified: false,
        disqualify_reason: null,
        created_at: '2026-07-31T10:00:00.000Z',
      },
    ];

    expect(normalizeRadarMatchResults(rows as Array<Record<string, unknown>>)).toEqual([
      {
        id: 'match-1',
        profile_id: 'profile-1',
        job_source: 'linkedin',
        job_id: 'job-1',
        final_average_score: 82,
        score_breakdown: {
          role_match: { score: 95, candidate_value: 'Senior React Developer', job_value: 'Senior React Engineer', rule: 'Title match' },
        },
        ai_notes: 'Strong fit',
        disqualified: false,
        disqualify_reason: null,
        created_at: '2026-07-31T10:00:00.000Z',
      },
    ]);
  });
});
