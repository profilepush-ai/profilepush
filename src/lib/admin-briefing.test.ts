import { describe, expect, it } from 'vitest';
import {
  buildHighlights,
  buildIssues,
  EXPERIMENT_CATALOGUE,
  experimentsForWeek,
  weekStartOf,
  type MetricSeries,
} from './admin-briefing';

const series = (key: string, title: string, counts: number[], targets: number[] = []): MetricSeries => ({
  key,
  title,
  points: counts.map((count, i) => ({ key: `2026-09-${String(i + 1).padStart(2, '0')}`, count })),
  targets: targets.map((count, i) => ({ key: `2026-09-${String(i + 1).padStart(2, '0')}`, count })),
});

describe('buildIssues', () => {
  it('flags a metric that is entirely absent', () => {
    const issues = buildIssues([series('chats', 'Chats', [0, 0, 0, 0])]);
    expect(issues[0].text).toContain('nothing at all');
    expect(issues[0].tone).toBe('bad');
  });

  it('flags a fall of more than 15%', () => {
    const issues = buildIssues([series('pitches', 'AI pitches', [10, 10, 5, 5])]);
    expect(issues.some((i) => i.text.includes('down -50%'))).toBe(true);
  });

  it('flags a pipeline that went quiet after being active', () => {
    // Three zero days at the end, with activity before, is a broken job far
    // more often than a slow week.
    const issues = buildIssues([series('posts', 'Job posts', [8, 9, 0, 0, 0])]);
    expect(issues.some((i) => i.text.includes('three days'))).toBe(true);
  });

  it('flags being behind plan', () => {
    const issues = buildIssues([series('signups', 'Signups', [10, 10, 4], [10, 10, 10])]);
    expect(issues.some((i) => i.text.includes('behind plan'))).toBe(true);
  });

  it('puts known blockers above anything derived from the data', () => {
    const blockers = [{ key: 'deploy', text: 'admin-stats is not deployed', tone: 'bad' as const }];
    const issues = buildIssues([series('chats', 'Chats', [0, 0, 0, 0])], blockers);
    expect(issues[0].key).toBe('deploy');
  });

  it('never returns more than five', () => {
    const many = Array.from({ length: 12 }, (_, i) => series(`m${i}`, `Metric ${i}`, [0, 0, 0, 0]));
    expect(buildIssues(many)).toHaveLength(5);
  });
});

describe('buildHighlights', () => {
  it('reports a rise of at least 10%', () => {
    const highlights = buildHighlights([series('signups', 'Signups', [4, 4, 8, 8])]);
    expect(highlights.some((h) => h.text.includes('up +100%'))).toBe(true);
  });

  it('reports meeting plan on the latest day', () => {
    const highlights = buildHighlights([series('signups', 'Signups', [2, 2, 12], [10, 10, 10])]);
    expect(highlights.some((h) => h.text.includes('met plan'))).toBe(true);
  });

  it('says nothing about a metric with no activity', () => {
    expect(buildHighlights([series('chats', 'Chats', [0, 0, 0, 0])])).toEqual([]);
  });

  it('never returns more than five', () => {
    const many = Array.from({ length: 12 }, (_, i) => series(`m${i}`, `Metric ${i}`, [1, 1, 9, 9]));
    expect(buildHighlights(many)).toHaveLength(5);
  });
});

describe('experimentsForWeek', () => {
  it('returns five', () => {
    expect(experimentsForWeek('2026-09-21')).toHaveLength(5);
  });

  it('gives the same five for the same week every time', () => {
    // A tick is only meaningful later if the week maps to a stable list.
    expect(experimentsForWeek('2026-09-21')).toEqual(experimentsForWeek('2026-09-21'));
  });

  it('moves the list on for the next week', () => {
    const thisWeek = experimentsForWeek('2026-09-21').map((e) => e.key);
    const nextWeek = experimentsForWeek('2026-09-28').map((e) => e.key);
    expect(nextWeek).not.toEqual(thisWeek);
  });

  it('wraps around the catalogue rather than running out', () => {
    const far = experimentsForWeek('2027-09-21');
    expect(far).toHaveLength(5);
    expect(far.every((e) => EXPERIMENT_CATALOGUE.some((c) => c.key === e.key))).toBe(true);
  });
});

describe('weekStartOf', () => {
  it('returns the Monday of that week', () => {
    expect(weekStartOf(new Date('2026-09-24T12:00:00.000Z'))).toBe('2026-09-21');
    expect(weekStartOf(new Date('2026-09-21T00:00:00.000Z'))).toBe('2026-09-21');
  });

  it('treats Sunday as the end of the week, not the start', () => {
    expect(weekStartOf(new Date('2026-09-27T23:00:00.000Z'))).toBe('2026-09-21');
  });
});
