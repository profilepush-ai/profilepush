import { describe, expect, it } from 'vitest';
import { buildFunnel, buildFunnelFlow, buildFunnelGraph, personaLess, signupsInRange, worstStep, type FunnelAccount } from './admin-funnel';

const account = (overrides: Partial<FunnelAccount> = {}): FunnelAccount => ({
  created_at: '2026-09-22T10:00:00.000Z',
  active_persona: 'vendor',
  session_count: 0,
  job_posts_count: 0,
  hotlist_posts_count: 0,
  job_previews_count: 0,
  hotlist_previews_count: 0,
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

describe('buildFunnelGraph', () => {
  const journeyed = (over: Partial<FunnelAccount> = {}) => account({
    session_count: 1, ai_match_runs_count: 1, ai_drafts_count: 1,
    gmail_connected: true, ai_pitches_count: 1, ...over,
  });

  it('never lets a link carry more than either node it touches', () => {
    const accounts = [
      journeyed(),
      journeyed({ gmail_connected: false, ai_pitches_count: 0 }),
      account({ session_count: 1 }),
      account(),
    ];
    const { nodes, links } = buildFunnelGraph(accounts, 'vendor', null, null);
    const countOf = (key: string) => nodes.find((n) => n.key === key)!.count;
    for (const link of links) {
      expect(link.count).toBeLessThanOrEqual(countOf(link.from));
      expect(link.count).toBeLessThanOrEqual(countOf(link.to));
    }
  });

  it('shows the drop from generating a draft to connecting Gmail', () => {
    const accounts = [
      journeyed(),
      journeyed({ gmail_connected: false, ai_pitches_count: 0 }),
      journeyed({ gmail_connected: false, ai_pitches_count: 0 }),
    ];
    const { nodes } = buildFunnelGraph(accounts, 'vendor', null, null);
    expect(nodes.find((n) => n.key === 'generated')!.count).toBe(3);
    expect(nodes.find((n) => n.key === 'connected')!.count).toBe(1);
  });

  it('keeps previewing off the main line', () => {
    // Previewed but never generated: it must not gate anything downstream.
    const accounts = [journeyed({ job_previews_count: 2 }), journeyed({ ai_drafts_count: 0, job_previews_count: 5 })];
    const { nodes } = buildFunnelGraph(accounts, 'vendor', null, null);
    expect(nodes.find((n) => n.key === 'previewed')!.count).toBe(2);
    expect(nodes.find((n) => n.key === 'previewed')!.aside).toBe(true);
    expect(nodes.find((n) => n.key === 'generated')!.count).toBe(1);
  });

  it('counts bulk sends separately from sends', () => {
    const accounts = [journeyed({ ai_bulk_sends_count: 4 }), journeyed()];
    const { nodes } = buildFunnelGraph(accounts, 'vendor', null, null);
    expect(nodes.find((n) => n.key === 'sent')!.count).toBe(2);
    expect(nodes.find((n) => n.key === 'bulk')!.count).toBe(1);
  });
});

describe('buildFunnelFlow', () => {
  const journeyed = (over: Partial<FunnelAccount> = {}) => account({
    session_count: 1, ai_match_runs_count: 1, ai_drafts_count: 1,
    gmail_connected: true, ai_pitches_count: 1, ...over,
  });

  it('conserves flow: every split sums to its parent', () => {
    const accounts = [
      journeyed(),
      journeyed({ gmail_connected: false, ai_pitches_count: 0 }),
      journeyed({ ai_drafts_count: 0, job_previews_count: 3, gmail_connected: false, ai_pitches_count: 0 }),
      account({ session_count: 1 }),
      account(),
    ];
    const { nodes, links } = buildFunnelFlow(accounts, 'vendor', null, null);
    const countOf = (key: string) => nodes.find((n) => n.key === key)!.count;
    const parents = [...new Set(links.map((l) => l.from))];
    for (const parent of parents) {
      const out = links.filter((l) => l.from === parent).reduce((sum, l) => sum + l.count, 0);
      expect(out).toBe(countOf(parent));
    }
  });

  it('puts an account that generated and previewed on the paying path, not the aside', () => {
    const both = journeyed({ job_previews_count: 4 });
    const { nodes } = buildFunnelFlow([both], 'vendor', null, null);
    expect(nodes.find((n) => n.key === 'generated')!.count).toBe(1);
    expect(nodes.find((n) => n.key === 'previewed_only')!.count).toBe(0);
  });

  it('never lets a node exceed its parent', () => {
    const accounts = [journeyed(), journeyed({ ai_bulk_sends_count: 2 }), account({ session_count: 1 })];
    const { nodes, links } = buildFunnelFlow(accounts, 'vendor', null, null);
    const countOf = (key: string) => nodes.find((n) => n.key === key)!.count;
    for (const link of links) expect(countOf(link.to)).toBeLessThanOrEqual(countOf(link.from));
  });
});
