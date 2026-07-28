import { describe, expect, it } from 'vitest';
import { getMatchHealthPercent } from './match-health';

describe('getMatchHealthPercent', () => {
  it('returns 0 when no match-rule fields are filled', () => {
    expect(getMatchHealthPercent({})).toBe(0);
  });

  it('returns the same percentage for the same field set across profiles', () => {
    const profile = {
      target_role: 'Senior React Developer',
      years_experience: 6,
      visa_status: 'H1B',
      work_authorization: 'C2C',
      work_type: 'Remote',
      preferred_locations: 'Austin, TX',
      desired_salary_min: 70,
      desired_salary_max: 100,
    };

    expect(getMatchHealthPercent(profile)).toBe(100);
  });

  it('counts only the shared match-rule fields', () => {
    const profile = {
      target_role: 'Senior React Developer',
      years_experience: 6,
      visa_status: 'H1B',
      work_authorization: '',
      work_type: 'Remote',
      preferred_locations: '',
      desired_salary_min: 70,
      desired_salary_max: null,
    };

    expect(getMatchHealthPercent(profile)).toBe(63);
  });
});
