import { describe, expect, it } from 'vitest';
import { buildDemoRolePayload, getCreatedAtTimestamp, getDemoRoleAccountIds, getDemoRoleDisplayMatchCount, getLiveMatchActionLabel, getWatchListDisplayMatchCount } from './demo-role-utils';

describe('buildDemoRolePayload', () => {
  it('maps form values into the expected demo role payload', () => {
    const payload = buildDemoRolePayload('acct-123', {
      target_role: 'Senior Frontend Engineer',
      years_experience: '7',
      visa_status: 'H1B',
      work_authorization: 'W2',
      work_type: 'Remote',
      preferred_locations: 'Austin | Remote',
      desired_salary_min: '90',
      desired_salary_max: '120',
      relocation_open: true,
      priority_skills: 'React, TypeScript',
    });

    expect(payload).toEqual({
      account_id: 'acct-123',
      target_role: 'Senior Frontend Engineer',
      years_exp: 7,
      visa_status: 'H1B',
      employment_type: 'W2',
      work_type: 'Remote',
      preferred_locations: 'Austin | Remote',
      min_rate_usd_per_hr: 90,
      max_rate_usd_per_hr: 120,
      relocation_open: true,
      priority_skills: 'React, TypeScript',
      schedule_frequency: 'daily',
      is_active: true,
    });
  });

  it('returns null for invalid or missing created-at values', () => {
    expect(getCreatedAtTimestamp(undefined)).toBeNull();
    expect(getCreatedAtTimestamp('')).toBeNull();
    expect(getCreatedAtTimestamp('not-a-date')).toBeNull();
  });

  it('normalizes blank values to null and false', () => {
    const payload = buildDemoRolePayload('acct-123', {
      target_role: ' ',
      years_experience: '',
      visa_status: '',
      work_authorization: '',
      work_type: '',
      preferred_locations: '',
      desired_salary_min: '',
      desired_salary_max: '',
      relocation_open: false,
      priority_skills: '   ',
    });

    expect(payload.target_role).toBe('');
    expect(payload.years_exp).toBeNull();
    expect(payload.visa_status).toBeNull();
    expect(payload.employment_type).toBeNull();
    expect(payload.work_type).toBeNull();
    expect(payload.preferred_locations).toBeNull();
    expect(payload.min_rate_usd_per_hr).toBeNull();
    expect(payload.max_rate_usd_per_hr).toBeNull();
    expect(payload.priority_skills).toBeNull();
    expect(payload.relocation_open).toBe(false);
  });

  it('collects all accessible account ids for demo-role queries', () => {
    expect(getDemoRoleAccountIds('acct-1', [{ account_id: 'acct-1' }, { account_id: 'acct-2' }, { account_id: 'acct-1' }])).toEqual(['acct-1', 'acct-2']);
    expect(getDemoRoleAccountIds(null, [{ account_id: 'acct-2' }, { account_id: 'acct-3' }])).toEqual(['acct-2', 'acct-3']);
    expect(getDemoRoleAccountIds(undefined, [])).toEqual([]);
  });

  it('prefers the current loaded match count over stale fallback values', () => {
    expect(getDemoRoleDisplayMatchCount(20, 824)).toBe(20);
    expect(getDemoRoleDisplayMatchCount(null, 824)).toBe(824);
    expect(getDemoRoleDisplayMatchCount(undefined, undefined)).toBe(0);
  });

  it('uses the shared Live Match labels for the Watch List action flow', () => {
    expect(getLiveMatchActionLabel({ isScanning: false, isMatching: false })).toBe('Live Match');
    expect(getLiveMatchActionLabel({ isScanning: true, isMatching: false })).toBe('Scanning...');
    expect(getLiveMatchActionLabel({ isScanning: false, isMatching: true })).toBe('Matching...');
  });

  it('prefers the authoritative role match count over any shared loaded match list', () => {
    expect(getWatchListDisplayMatchCount(24, 824)).toBe(24);
    expect(getWatchListDisplayMatchCount(0, 824)).toBe(0);
    expect(getWatchListDisplayMatchCount(null, 5)).toBe(5);
    expect(getWatchListDisplayMatchCount(undefined, 0)).toBe(0);
  });
});
