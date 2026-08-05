import { describe, expect, it } from 'vitest';
import { buildProfileCardsFromRolesAndFeedRows, filterProfilesByQuery, sortProfilesByMetrics, type ProfileCardItem } from './profile-page-utils';

describe('profile leaderboard helpers', () => {
  const profiles: ProfileCardItem[] = [
    {
      target_role: 'Frontend Engineer',
      summary: 'React and TypeScript',
      priority_skills: 'React, TypeScript',
      jobsCount: 12,
      vendorsCount: 6,
    },
    {
      target_role: 'Backend Engineer',
      summary: 'Node and SQL',
      priority_skills: 'Node.js, SQL',
      jobsCount: 20,
      vendorsCount: 9,
    },
    {
      target_role: 'Staff Platform Engineer',
      summary: 'Distributed systems',
      priority_skills: 'Kubernetes, AWS',
      jobsCount: 20,
      vendorsCount: 3,
    },
  ];

  it('sorts leaderboard items by jobs count, then vendors count', () => {
    const sorted = sortProfilesByMetrics(profiles);
    expect(sorted.map((item) => item.target_role)).toEqual([
      'Backend Engineer',
      'Staff Platform Engineer',
      'Frontend Engineer',
    ]);
  });

  it('filters profiles by role, summary, or skills', () => {
    const filtered = filterProfilesByQuery(profiles, 'typescript');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].target_role).toBe('Frontend Engineer');
  });

  it('builds a profile card list even when feed rows are missing', () => {
    const mapped = buildProfileCardsFromRolesAndFeedRows([
      {
        target_role: 'Senior Frontend Engineer',
        summary: 'React and TypeScript',
        priority_skills: 'React, TypeScript',
        preferred_locations: 'Remote',
        visa_status: 'Open',
        employment_type: 'Full-time',
        work_type: 'Remote',
        min_years_exp: 5,
        max_years_exp: 8,
        min_rate_usd_per_hr: 70,
        max_rate_usd_per_hr: 100,
        relocation_open: true,
      },
    ], []);

    expect(mapped).toHaveLength(1);
    expect(mapped[0].jobsCount).toBe(0);
    expect(mapped[0].vendorsCount).toBe(0);
    expect(mapped[0].target_role).toBe('Senior Frontend Engineer');
  });
});
