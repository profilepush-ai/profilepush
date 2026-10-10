import { describe, expect, it } from 'vitest';
import { filterAndSortAccountStats } from './admin-dashboard-table';
import type { AccountRow } from './admin-account-stats';

const row = (overrides: Partial<AccountRow>): AccountRow => ({
  account_id: 'x', name: 'x', email: 'x@example.com', role: 'profiles', internal: false,
  created_at: '2026-10-01T00:00:00.000Z', age_days: 10, last_active: null,
  sessions: 0, active_seconds: 0, active_days: 0, gmail_connected: false, avatar_on: false, billing_currency: null,
  paid: false, revenue_inr: 0, revenue_usd: 0, credits_balance: 100, credits_bought: 0, credits_spent: 0,
  profiles_or_jobs: 0, matches: 0, matches_watched: 0, watched: 0, saved: 0, shared: 0, not_a_match: 0,
  applied_email: 0, applied_site: 0, ask_resume: 0, asks: 0, replies: 0, interviews: 0, placed: 0,
  ai_match_runs: 0, ai_apply_fills: 0, referrals_made: 0, referred_by: false, picture_reports: 0,
  emails_received: 0, teaser_state: 'none', last_match_at: null,
  ...overrides,
});

describe('filterAndSortAccountStats', () => {
  const rows = [
    row({ account_id: '1', name: 'Ava', email: 'ava@example.com', role: 'jobs', matches: 4, ask_resume: 2, last_active: '2026-10-05T09:00:00.000Z', paid: true }),
    row({ account_id: '2', name: 'Ben', email: 'ben@example.com', role: 'profiles', matches: 9, applied_email: 1, applied_site: 1, last_active: '2026-10-09T09:00:00.000Z' }),
    row({ account_id: '3', name: 'Cora', email: 'cora@other.com', role: 'job_seeker', matches: 1, applied_email: 5 }),
  ];
  const base = { query: '', role: 'all' as const, sortKey: 'created_at' as const, sortDirection: 'desc' as const };

  it('filters by search text and role', () => {
    expect(filterAndSortAccountStats(rows, { ...base, query: 'example' }).map((r) => r.account_id)).toEqual(['1', '2']);
    expect(filterAndSortAccountStats(rows, { ...base, role: 'job_seeker' }).map((r) => r.account_id)).toEqual(['3']);
    // The role's word is searchable too.
    expect(filterAndSortAccountStats(rows, { ...base, query: 'jobs' }).map((r) => r.account_id)).toEqual(['1']);
  });

  it('sorts numbers, and applied as the sum of its three ways', () => {
    expect(filterAndSortAccountStats(rows, { ...base, sortKey: 'matches' }).map((r) => r.account_id)).toEqual(['2', '1', '3']);
    expect(filterAndSortAccountStats(rows, { ...base, sortKey: 'applied' }).map((r) => r.account_id)).toEqual(['3', '1', '2']);
  });

  it('keeps accounts never active last, whichever way dates sort', () => {
    expect(filterAndSortAccountStats(rows, { ...base, sortKey: 'last_active' }).map((r) => r.account_id)).toEqual(['2', '1', '3']);
    expect(filterAndSortAccountStats(rows, { ...base, sortKey: 'last_active', sortDirection: 'asc' }).map((r) => r.account_id)).toEqual(['1', '2', '3']);
  });

  it('sorts yes/no columns with yes first when descending', () => {
    expect(filterAndSortAccountStats(rows, { ...base, sortKey: 'paid' })[0].account_id).toBe('1');
  });
});
