import { describe, expect, it } from 'vitest';
import { buildSignupSeries } from './admin-signups-series';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const account = (created_at: string) => ({ created_at });

describe('buildSignupSeries', () => {
  it('emits a point for every day in the window, including empty ones', () => {
    const series = buildSignupSeries(
      [account('2026-09-20T09:00:00.000Z'), account('2026-09-22T01:00:00.000Z')],
      '2026-09-20T00:00:00.000Z',
      null,
      NOW,
    );
    // Without the gap fill, the 21st would vanish and two signups two days
    // apart would render as adjacent points — a quiet day read as growth.
    expect(series).toEqual([
      { key: '2026-09-20', count: 1 },
      { key: '2026-09-21', count: 0 },
      { key: '2026-09-22', count: 1 },
    ]);
  });

  it('buckets by UTC day, not local day', () => {
    // 23:30 UTC is the next day in Asia/Kolkata. Bucketing locally would file
    // this under the 21st and disagree with the table, which filters in UTC.
    const series = buildSignupSeries(
      [account('2026-09-20T23:30:00.000Z')],
      '2026-09-20T00:00:00.000Z',
      '2026-09-20T23:59:59.999Z',
      NOW,
    );
    expect(series).toEqual([{ key: '2026-09-20', count: 1 }]);
  });

  it('excludes accounts outside the range', () => {
    const series = buildSignupSeries(
      [
        account('2026-09-19T12:00:00.000Z'), // before
        account('2026-09-20T12:00:00.000Z'), // inside
        account('2026-09-23T12:00:00.000Z'), // after
      ],
      '2026-09-20T00:00:00.000Z',
      '2026-09-21T23:59:59.999Z',
      NOW,
    );
    expect(series.reduce((n, p) => n + p.count, 0)).toBe(1);
    expect(series).toHaveLength(2);
  });

  it('starts at the earliest signup when the range is open-ended', () => {
    const series = buildSignupSeries(
      [account('2026-09-19T12:00:00.000Z'), account('2026-09-21T12:00:00.000Z')],
      null,
      null,
      NOW,
    );
    expect(series[0]).toEqual({ key: '2026-09-19', count: 1 });
    expect(series[series.length - 1].key).toBe('2026-09-22');
  });

  it('returns nothing when there are no accounts and no start date', () => {
    expect(buildSignupSeries([], null, null, NOW)).toEqual([]);
  });

  it('survives an inverted custom range instead of looping forever', () => {
    const series = buildSignupSeries(
      [account('2026-09-20T12:00:00.000Z')],
      '2026-09-25T00:00:00.000Z',
      '2026-09-20T00:00:00.000Z',
      NOW,
    );
    expect(series).toEqual([]);
  });

  it('caps a pathological range rather than building tens of thousands of points', () => {
    const series = buildSignupSeries([], '1990-01-01T00:00:00.000Z', null, NOW);
    expect(series).toHaveLength(400);
  });

  it('ignores unparseable timestamps', () => {
    const series = buildSignupSeries(
      [account('not a date'), account('2026-09-22T05:00:00.000Z')],
      '2026-09-22T00:00:00.000Z',
      null,
      NOW,
    );
    expect(series).toEqual([{ key: '2026-09-22', count: 1 }]);
  });
});
