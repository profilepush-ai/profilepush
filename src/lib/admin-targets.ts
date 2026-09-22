// Targets and trend direction for the admin dashboard.
//
// The plan is 10 signups a day compounding 5% daily. That is steep on purpose
// — 5% a day is ×4.3 in a month and ×80 in ninety days, so the 10/day target
// reaches roughly 800/day by day 90 and passes 500/day around day 79. Worth
// knowing before reading a red dot as a crisis: against a curve this steep,
// flat is behind.
//
// Every other metric gets the same curve anchored on its own starting level,
// so a chart can show "where this should be by now" without someone having to
// set a number for each one.

import type { SignupPoint } from './admin-signups-series';

export const TARGET_START_DATE = '2026-09-22';
export const SIGNUPS_BASE_TARGET = 10;
export const DAILY_GROWTH_RATE = 0.05;

export type Trend = {
  /** Mean per day over the recent half of the window. */
  recent: number;
  /** Mean per day over the half before it. */
  previous: number;
  /** Signed fraction, e.g. 0.2 for +20%. Null when there is no base to compare. */
  change: number | null;
  direction: 'up' | 'down' | 'flat';
};

function daysBetween(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00.000Z`);
  const to = Date.parse(`${toKey}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/** The compounding target for one day. */
export function targetForDate(dateKey: string, base: number, startDate = TARGET_START_DATE): number {
  const elapsed = daysBetween(startDate, dateKey);
  // Before the plan starts the target is simply the base — extrapolating
  // backwards would draw a target approaching zero and make early history look
  // like runaway success.
  if (elapsed <= 0) return base;
  return base * (1 + DAILY_GROWTH_RATE) ** elapsed;
}

/**
 * A target line matching a metric's own points.
 *
 * Signups use the stated plan (10/day). Every other metric anchors on its own
 * opening level — the mean of the first three days, so a single quiet Sunday
 * does not set the bar for the quarter — and grows at the same rate. A metric
 * that starts at zero gets no target line at all rather than a flat zero line,
 * which would mark every day as a win.
 */
export function buildTargetSeries(points: SignupPoint[], explicitBase?: number): SignupPoint[] {
  if (!points.length) return [];
  const base = explicitBase ?? openingLevel(points);
  if (!base) return [];
  return points.map((point) => ({ key: point.key, count: targetForDate(point.key, base, points[0].key) }));
}

function openingLevel(points: SignupPoint[]): number {
  const head = points.slice(0, 3);
  if (!head.length) return 0;
  const mean = head.reduce((sum, p) => sum + p.count, 0) / head.length;
  return mean;
}

/**
 * Direction of travel: the recent half of the window against the half before.
 *
 * Halves rather than last-day-vs-yesterday because daily counts at this volume
 * swing wildly — one busy afternoon would flip the dot green and tell nobody
 * anything.
 */
export function trendOf(points: SignupPoint[]): Trend {
  if (points.length < 2) return { recent: 0, previous: 0, change: null, direction: 'flat' };

  const half = Math.floor(points.length / 2);
  const previousPoints = points.slice(0, half);
  const recentPoints = points.slice(points.length - half);

  const mean = (rows: SignupPoint[]) => (rows.length ? rows.reduce((sum, p) => sum + p.count, 0) / rows.length : 0);
  const previous = mean(previousPoints);
  const recent = mean(recentPoints);

  if (previous === 0) {
    // Growth from nothing is not a percentage. Say up or flat and let the
    // absolute number carry the meaning.
    return { recent, previous, change: null, direction: recent > 0 ? 'up' : 'flat' };
  }

  const change = (recent - previous) / previous;
  // Under a percentage point either way is noise, not a direction.
  const direction = Math.abs(change) < 0.01 ? 'flat' : change > 0 ? 'up' : 'down';
  return { recent, previous, change, direction };
}

/** Where the latest day sits against its target. */
export function againstTarget(points: SignupPoint[], targets: SignupPoint[]): number | null {
  if (!points.length || !targets.length) return null;
  const latest = points[points.length - 1];
  const target = targets[targets.length - 1];
  if (!target || target.count === 0) return null;
  return (latest.count - target.count) / target.count;
}

export function formatChange(change: number | null): string {
  if (change === null) return '—';
  const pct = Math.round(change * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}
