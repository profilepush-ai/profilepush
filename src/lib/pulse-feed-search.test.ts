import { describe, expect, it } from 'vitest';
import { matchesPulseFeedSearch } from './pulse-feed-search';

describe('matchesPulseFeedSearch', () => {
  it('matches role and skill text across all fields', () => {
    const candidate = {
      roleTitle: 'Senior Frontend Engineer',
      title: 'React Engineer',
      company: 'Acme Labs',
      location: 'Austin, TX',
      posterName: 'Nina',
      employmentType: 'Full-time',
      seniority: 'Senior',
      salaryRange: '$140-$180/hr',
      hourlyRate: '$150/hr',
      snippet: 'Looking for React and TypeScript expert',
      skills: ['React', 'TypeScript', 'Tailwind'],
      experienceYears: 7,
      visaTypes: ['H1B', 'GC'],
    };

    expect(matchesPulseFeedSearch(candidate, 'react typescript', 'all')).toBe(true);
    expect(matchesPulseFeedSearch(candidate, 'h1b', 'visa')).toBe(true);
    expect(matchesPulseFeedSearch(candidate, 'austin', 'location')).toBe(true);
    expect(matchesPulseFeedSearch(candidate, '7', 'experience')).toBe(true);
    expect(matchesPulseFeedSearch(candidate, '150', 'rate')).toBe(true);
  });

  it('matches role-title search in the role scope', () => {
    const candidate = {
      roleTitle: 'Senior Frontend Engineer',
      title: 'React Engineer',
      skills: ['React', 'TypeScript'],
      visaTypes: ['H1B'],
    };

    expect(matchesPulseFeedSearch(candidate, 'senior frontend', 'role')).toBe(true);
  });

  it('returns false when the query is not found in the selected field', () => {
    const candidate = {
      roleTitle: 'Senior Frontend Engineer',
      title: 'React Engineer',
      skills: ['React', 'TypeScript'],
      visaTypes: ['H1B'],
    };

    expect(matchesPulseFeedSearch(candidate, 'python', 'skills')).toBe(false);
    expect(matchesPulseFeedSearch(candidate, 'opt', 'visa')).toBe(false);
  });
});
