import { describe, expect, it } from 'vitest';
import { buildFunnel, personaLess, signupsInRange, worstStep, type FunnelAccount } from './admin-funnel';

const account = (overrides: Partial<FunnelAccount> = {}): FunnelAccount => ({
  created_at: '2026-09-22T10:00:00.000Z',
  active_persona: 'vendor',
  session_count: 0,
  job_posts_count: 0,
  hotlist_posts_count: 0,
  job_previews_count: 0,
  hotlist_previews_count: 0,
  ai_pitches_count: 0,
  ai_requests_count: 0,
  ai_match_runs_count: 0,
  gmail_connected: false,
  active_days: 0,
  is_trial: true,
  ...overrides,
});

describe('buildFunnel', () => {
  it('counts each stage against the one above it', () => {
    const full = account({
      session_count: 2, job_previews_count: 3, ai_pitches_count: 1,
      job_posts_count: 1, ai_match_runs_count: 1, active_days: 3, is_trial: false,
    });
    const accounts = [full, account({ session_count: 1, job_previews_count: 1 }), account({ session_count: 1 }), account()];
    const stages = buildFunnel(accounts, 'vendor', null, null);
    // persona, signed in, matched, acted, returned, paid
    expect(stages.map((s) => s.key)).toEqual(['persona', 'signed_in', 'matched', 'acted', 'returned', 'paid']);
    expect(stages.map((s) => s.count)).toEqual([4, 3, 1, 1, 1, 1]);
    expect(stages[1].stepRate).toBeCloseTo(0.75, 5);
    expect(stages[1].dropped).toBe(1);
  });

  it('ends on the paid conversion', () => {
    const accounts = [
      account({ session_count: 1, ai_match_runs_count: 1, job_previews_count: 1, active_days: 2, is_trial: false }),
      account({ session_count: 1, ai_match_runs_count: 1, job_previews_count: 1, active_days: 2, is_trial: true }),
    ];
    const stages = buildFunnel(accounts, 'vendor', null, null);
    const paid = stages[stages.length - 1];
    expect(paid.key).toBe('paid');
    expect(paid.count).toBe(1);
    expect(paid.overallRate).toBeCloseTo(0.5, 5);
  });

  it('never lets a stage rise above the one before it', () => {
    const accounts = [account({ session_count: 1, ai_match_runs_count: 5, active_days: 9 })];
    const stages = buildFunnel(accounts, 'vendor', null, null);
    const counts = stages.map((s) => s.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    // Ran a match, so it counts there — under the old order this account was
    // dropped at "previewed" and reported zero matches, which was the bug.
    expect(stages[2].count).toBe(1);
    // Never previewed and never submitted, so it stops at the next step.
    expect(stages[3].count).toBe(0);
    expect(stages[4].count).toBe(0);
  });

  it('passes an account that only previewed, and one that only submitted', () => {
    const previewedOnly = account({ session_count: 1, ai_match_runs_count: 1, hotlist_previews_count: 2 });
    const submittedOnly = account({ session_count: 1, ai_match_runs_count: 1, ai_requests_count: 1 });
    const stages = buildFunnel([previewedOnly, submittedOnly], 'vendor', null, null);
    // Either one is the same signal, so both clear the combined stage.
    expect(stages[3].key).toBe('acted');
    expect(stages[3].count).toBe(2);
  });

  it('keeps the two personas apart', () => {
    const accounts = [account({ active_persona: 'vendor' }), account({ active_persona: 'bench_sales' })];
    expect(buildFunnel(accounts, 'vendor', null, null)[0].count).toBe(1);
    expect(buildFunnel(accounts, 'bench_sales', null, null)[0].count).toBe(1);
  });

  it('excludes accounts with no persona from both funnels', () => {
    const accounts = [account({ active_persona: null }), account({ active_persona: 'vendor' })];
    expect(buildFunnel(accounts, 'vendor', null, null)[0].count).toBe(1);
    expect(buildFunnel(accounts, 'bench_sales', null, null)[0].count).toBe(0);
    expect(personaLess(accounts, null, null)).toBe(1);
  });

  it('honours the date range', () => {
    const accounts = [
      account({ created_at: '2026-09-01T10:00:00.000Z' }),
      account({ created_at: '2026-09-22T10:00:00.000Z' }),
    ];
    const stages = buildFunnel(accounts, 'vendor', '2026-09-20T00:00:00.000Z', null);
    expect(stages[0].count).toBe(1);
    expect(signupsInRange(accounts, '2026-09-20T00:00:00.000Z', null)).toBe(1);
  });

  it('reports zero rates rather than dividing by zero on an empty cohort', () => {
    const stages = buildFunnel([], 'vendor', null, null);
    expect(stages[0].count).toBe(0);
    expect(stages[1].stepRate).toBe(0);
    expect(stages[2].overallRate).toBe(0);
  });
});

describe('worstStep', () => {
  it('finds the steepest drop', () => {
    const accounts = [
      account({ session_count: 1 }),
      account({ session_count: 1 }),
      account({ session_count: 1 }),
      account({ session_count: 1 }),
    ];
    // Everyone signs in, nobody runs a match: matching is the wall.
    const stages = buildFunnel(accounts, 'vendor', null, null);
    expect(worstStep(stages)?.key).toBe('matched');
  });

  it('returns nothing when no one drops out', () => {
    const accounts = [account({
      session_count: 1, ai_match_runs_count: 1, job_previews_count: 1,
      active_days: 2, is_trial: false,
    })];
    expect(worstStep(buildFunnel(accounts, 'vendor', null, null))).toBeNull();
  });
});

describe('routes', () => {
  it('splits the combined stage by how it was cleared, adding up to its count', () => {
    const accounts = [
      account({ session_count: 1, ai_match_runs_count: 1, job_previews_count: 1 }),
      account({ session_count: 1, ai_match_runs_count: 1, ai_pitches_count: 1 }),
      account({ session_count: 1, ai_match_runs_count: 1, hotlist_previews_count: 1, ai_requests_count: 1 }),
    ];
    const acted = buildFunnel(accounts, 'vendor', null, null).find((s) => s.key === 'acted');
    expect(acted?.count).toBe(3);
    expect(acted?.routes).toEqual([
      { label: 'Previewed only', count: 1 },
      { label: 'AI submit only', count: 1 },
      { label: 'Both', count: 1 },
    ]);
    // Routes are counted within the stage, so they can never exceed it.
    expect(acted?.routes?.reduce((sum, r) => sum + r.count, 0)).toBe(acted?.count);
  });
});
