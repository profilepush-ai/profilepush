import { describe, expect, it } from 'vitest';
import { buildProfileBoardStats } from './job-finder-stats';

describe('buildProfileBoardStats', () => {
  it('counts only jobs and matches from the most recent search per profile and board', () => {
    const result = buildProfileBoardStats({
      profiles: [{ id: 'p1' }, { id: 'p2' }],
      boardSearches: [[
        { id: 's1', profile_id: 'p1', created_at: '2024-01-01T00:00:00.000Z' },
        { id: 's2', profile_id: 'p1', created_at: '2024-01-02T00:00:00.000Z' },
        { id: 's3', profile_id: 'p2', created_at: '2024-01-01T00:00:00.000Z' },
      ]],
      boardJobs: [[
        { id: 'j1', search_id: 's1' },
        { id: 'j2', search_id: 's2' },
        { id: 'j3', search_id: 's2' },
        { id: 'j4', search_id: 's3' },
      ]],
      scoreRows: [
        { profile_id: 'p1', linkedin_job_id: 'j1' },
        { profile_id: 'p1', linkedin_job_id: 'j2' },
        { profile_id: 'p2', linkedin_job_id: 'j4' },
        { profile_id: 'p2', linkedin_job_id: 'missing' },
      ],
    });

    expect(result).toEqual({
      p1: { fetched: 2, matched: 1 },
      p2: { fetched: 1, matched: 1 },
    });
  });
});
