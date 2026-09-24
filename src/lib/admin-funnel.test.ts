import { describe, expect, it } from 'vitest';
import { buildFunnel, creditBands, personaLess, signupsInRange, worstStep, type FunnelAccount } from './admin-funnel';

const account = (overrides: Partial<FunnelAccount> = {}): FunnelAccount => ({
  created_at: '2026-09-22T10:00:00.000Z',
  active_persona: 'vendor',
  session_count: 0,
  job_posts_count: 0,
  hotlist_posts_count: 0,
  job_previews_count: 0,
  hotlist_previews_count: 0,
  credits_granted: 100,
  credits_spent: 0,
  ai_drafts_count: 0,
  ai_bulk_sends_count: 0,
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
      session_count: 2, ai_match_runs_count: 1, ai_drafts_count: 1, gmail_connected: true,
      ai_pitches_count: 1, active_days: 3, credits_spent: 500, is_trial: false,
    });
    const accounts = [full, account({ session_count: 1, job_previews_count: 1 }), account({ session_count: 1 }), account()];
    const stages = buildFunnel(accounts, 'vendor', null, null);
    expect(stages.map((s) => s.key)).toEqual(
      ['persona', 'signed_in', 'matched', 'generated', 'connected', 'sent', 'returned', 'paid']);
    expect(stages.map((s) => s.count)).toEqual([4, 3, 1, 1, 1, 1, 1, 1]);
    expect(stages[1].stepRate).toBeCloseTo(0.75, 5);
    expect(stages[1].dropped).toBe(1);
  });

  it('ends on the paid conversion', () => {
    const accounts = [
      account({ session_count: 1, ai_match_runs_count: 1, ai_drafts_count: 1, gmail_connected: true, ai_pitches_count: 1, active_days: 2, credits_spent: 500, is_trial: false }),
      account({ session_count: 1, ai_match_runs_count: 1, ai_drafts_count: 1, gmail_connected: true, ai_pitches_count: 1, active_days: 2, credits_spent: 500, is_trial: true }),
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
    // Never generated a draft, so it stops there and stays stopped.
    expect(stages[3].count).toBe(0);
    expect(stages[4].count).toBe(0);
  });

  it('separates generating a draft from connecting a mailbox', () => {
    // The drop this funnel exists to show: a credit spent on a draft that
    // cannot be sent, because no mailbox is connected.
    const generatedOnly = account({ session_count: 1, ai_match_runs_count: 1, ai_drafts_count: 1 });
    const wentAllTheWay = account({
      session_count: 1, ai_match_runs_count: 1, ai_drafts_count: 1,
      gmail_connected: true, ai_pitches_count: 1,
    });
    const stages = buildFunnel([generatedOnly, wentAllTheWay], 'vendor', null, null);
    expect(stages[3].key).toBe('generated');
    expect(stages[3].count).toBe(2);
    expect(stages[4].key).toBe('connected');
    expect(stages[4].count).toBe(1);
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
      session_count: 1, ai_match_runs_count: 1, ai_drafts_count: 1, gmail_connected: true,
      ai_pitches_count: 1, active_days: 2, credits_spent: 500, is_trial: false,
    })];
    expect(worstStep(buildFunnel(accounts, 'vendor', null, null))).toBeNull();
  });
});

describe('creditBands', () => {
  it('counts "10%" as 10% or more, so the bands nest', () => {
    // Grant of 100: 8 is under a tenth, 12 is over it.
    const accounts = [8, 12, 30, 100].map((credits_spent) => account({ credits_spent }));
    const bands = creditBands(accounts, null, null);
    expect(bands.map((b) => b.count)).toEqual([3, 2, 1, 1]);
    expect(bands.map((b) => b.label)).toEqual(['10%+ of credits', '25%+ of credits', '50%+ of credits', '100%+ of credits']);
  });

  it('measures each account against its own grant', () => {
    // The grant was cut from 500 to 100, so the same spend is a different
    // share depending on when the account was created.
    const newAccount = account({ credits_granted: 100, credits_spent: 60 });
    const oldAccount = account({ credits_granted: 500, credits_spent: 60 });
    expect(creditBands([newAccount], null, null).map((b) => b.count)).toEqual([1, 1, 1, 0]);
    expect(creditBands([oldAccount], null, null).map((b) => b.count)).toEqual([1, 0, 0, 0]);
  });

  it('counts spenders the funnel cannot reach', () => {
    // The reason these moved out of the funnel: someone can burn half the
    // grant without ever connecting a mailbox or sending anything, and as a
    // funnel stage under "Sent" they would read zero.
    const spenderWhoNeverSent = account({ session_count: 1, credits_spent: 60 });
    expect(creditBands([spenderWhoNeverSent], null, null)[2].count).toBe(1);
    expect(buildFunnel([spenderWhoNeverSent], 'vendor', null, null).find((s) => s.key === 'sent')!.count).toBe(0);
  });
});
