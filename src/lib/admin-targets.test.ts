import { describe, expect, it } from 'vitest';
import {
  againstTarget,
  buildTargetSeries,
  formatChange,
  SIGNUPS_BASE_TARGET,
  targetForDate,
  trendOf,
} from './admin-targets';

const point = (key: string, count: number) => ({ key, count });

describe('targetForDate', () => {
  it('is the base on the start date', () => {
    expect(targetForDate('2026-09-22', 10, '2026-09-22')).toBe(10);
  });

  it('compounds 5% a day', () => {
    expect(targetForDate('2026-09-23', 10, '2026-09-22')).toBeCloseTo(10.5, 5);
    expect(targetForDate('2026-10-22', 10, '2026-09-22')).toBeCloseTo(10 * 1.05 ** 30, 5);
  });

  it('reaches the 500/day goal on day 81 and ~800 by day 90', () => {
    // 1.05^n = 50 at n = 80.2, so day 81 is the first day the curve clears 500.
    expect(targetForDate('2026-12-11', 10, '2026-09-22')).toBeLessThan(500);
    expect(targetForDate('2026-12-12', 10, '2026-09-22')).toBeGreaterThan(500);
    expect(targetForDate('2026-12-21', 10, '2026-09-22')).toBeCloseTo(10 * 1.05 ** 90, 0);
  });

  it('does not extrapolate backwards before the plan starts', () => {
    // Otherwise the target curves down towards zero in history and every past
    // day scores as a runaway win.
    expect(targetForDate('2026-09-01', 10, '2026-09-22')).toBe(10);
  });
});

describe('buildTargetSeries', () => {
  it('uses the stated base for signups', () => {
    const points = [point('2026-09-22', 4), point('2026-09-23', 6)];
    const targets = buildTargetSeries(points, SIGNUPS_BASE_TARGET);
    expect(targets[0].count).toBe(10);
    expect(targets[1].count).toBeCloseTo(10.5, 5);
  });

  it('anchors other metrics on their own three-day opening mean', () => {
    const points = [point('2026-09-22', 0), point('2026-09-23', 30), point('2026-09-24', 30), point('2026-09-25', 40)];
    const targets = buildTargetSeries(points);
    // Mean of 0, 30, 30 — one quiet opening day should not set the bar alone.
    expect(targets[0].count).toBeCloseTo(20, 5);
  });

  it('draws no target for a metric that is flat zero', () => {
    const points = [point('2026-09-22', 0), point('2026-09-23', 0)];
    expect(buildTargetSeries(points)).toEqual([]);
  });

  it('returns nothing for an empty series', () => {
    expect(buildTargetSeries([])).toEqual([]);
  });
});

describe('trendOf', () => {
  it('compares the recent half against the earlier half', () => {
    const points = [point('d1', 2), point('d2', 2), point('d3', 4), point('d4', 4)];
    const trend = trendOf(points);
    expect(trend.previous).toBe(2);
    expect(trend.recent).toBe(4);
    expect(trend.change).toBeCloseTo(1, 5);
    expect(trend.direction).toBe('up');
  });

  it('calls a fall a fall', () => {
    const points = [point('d1', 10), point('d2', 10), point('d3', 5), point('d4', 5)];
    expect(trendOf(points).direction).toBe('down');
  });

  it('treats sub-1% movement as flat rather than a direction', () => {
    const points = [point('d1', 100), point('d2', 100), point('d3', 100), point('d4', 100.5)];
    expect(trendOf(points).direction).toBe('flat');
  });

  it('does not report a percentage when growing from zero', () => {
    const points = [point('d1', 0), point('d2', 0), point('d3', 3), point('d4', 3)];
    const trend = trendOf(points);
    expect(trend.change).toBeNull();
    expect(trend.direction).toBe('up');
  });

  it('is flat with fewer than two points', () => {
    expect(trendOf([point('d1', 5)]).direction).toBe('flat');
    expect(trendOf([]).direction).toBe('flat');
  });
});

describe('againstTarget', () => {
  it('measures the latest day against the latest target', () => {
    const points = [point('2026-09-22', 5)];
    const targets = [point('2026-09-22', 10)];
    expect(againstTarget(points, targets)).toBeCloseTo(-0.5, 5);
  });

  it('returns null when there is no target to measure against', () => {
    expect(againstTarget([point('2026-09-22', 5)], [])).toBeNull();
    expect(againstTarget([], [point('2026-09-22', 10)])).toBeNull();
  });
});

describe('formatChange', () => {
  it('signs the number and marks an unknown change', () => {
    expect(formatChange(0.2)).toBe('+20%');
    expect(formatChange(-0.35)).toBe('-35%');
    expect(formatChange(null)).toBe('—');
  });
});
