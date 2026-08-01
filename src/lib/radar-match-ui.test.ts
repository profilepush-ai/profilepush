import { describe, expect, it } from 'vitest';
import { buildScoreBreakdownDisplayItems, getDisplayJobTitle, getDisplayJobDescription, getSourceBadgeDisplayName, getSourceCategoryLabel } from './radar-match-ui';

describe('radar match UI helpers', () => {
  it('adds an employment type row when profile and job values are present', () => {
    const items = buildScoreBreakdownDisplayItems(
      {
        role_match: { score: 90, candidate_value: 'Engineer', job_value: 'Engineer', rule: 'role' },
      },
      { work_authorization: 'C2C' },
      { employment_type: 'C2C' },
    );

    expect(items.some(item => item.key === 'employment_type_match')).toBe(true);
    expect(items.find(item => item.key === 'employment_type_match')?.score).toBe(100);
  });

  it('adds a distinct work type row when profile and job values are present', () => {
    const items = buildScoreBreakdownDisplayItems(
      {
        role_match: { score: 90, candidate_value: 'Engineer', job_value: 'Engineer', rule: 'role' },
      },
      { work_authorization: 'C2C', work_type: 'Remote' },
      { employment_type: 'C2C', work_type: 'Remote' },
    );

    expect(items.some(item => item.key === 'employment_type_match')).toBe(true);
    expect(items.some(item => item.key === 'work_type_match')).toBe(true);
    expect(items.find(item => item.key === 'work_type_match')?.score).toBe(100);
  });

  it('uses a readable fallback title when the title is missing but a description exists', () => {
    expect(getDisplayJobTitle({ job_title: null, company_name: 'Acme', job_description: 'We are hiring a senior engineer.' })).toBe('We are hiring a senior engineer.');
  });

  it('falls back to post content when job description is missing', () => {
    const description = getDisplayJobDescription({ job_description: null, post_content: 'We are hiring a senior engineer.' });
    expect(description).toBe('We are hiring a senior engineer.');
  });

  it('labels watch-list matches as role-driven source category chips', () => {
    expect(getSourceCategoryLabel('watch-list')).toBe('Role Match');
  });

  it('uses the shared badge name for watch-list matches', () => {
    expect(getSourceBadgeDisplayName('watch-list')).toBe('Role Match');
  });
});
