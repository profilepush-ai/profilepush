// Buckets accounts into one point per day for the admin signups chart.
//
// Separated from the chart component because this is the part that can be
// wrong without looking wrong: an off-by-one timezone shift or a missing
// empty day both render as a perfectly plausible line.

export type SignupPoint = { key: string; count: number };

// UTC throughout: created_at is stored in UTC and admin-stats filters on it in
// UTC, so bucketing by local date would shift signups into the wrong day for
// anyone east or west of the server and make the chart disagree with the table
// beside it.
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Hard ceiling so a nonsense custom range cannot spin forever. */
const MAX_POINTS = 400;

export function buildSignupSeries(
  accounts: Array<{ created_at: string }>,
  startDate: string | null,
  endDate: string | null,
  now: Date = new Date(),
): SignupPoint[] {
  const counts = new Map<string, number>();
  let earliest: Date | null = null;

  const from = startDate ? new Date(startDate) : null;
  const to = endDate ? new Date(endDate) : null;

  for (const account of accounts) {
    const created = new Date(account.created_at);
    if (Number.isNaN(created.getTime())) continue;
    if (from && created < from) continue;
    if (to && created > to) continue;
    const key = dayKey(created);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!earliest || created < earliest) earliest = created;
  }

  // Every day in the window gets a point, including the empty ones. Plotting
  // only the days that had signups would space them evenly and turn a quiet
  // week into a line that looks like steady growth.
  const first = from ?? earliest;
  if (!first) return [];
  const last = to ?? now;
  if (dayKey(last) < dayKey(first)) return [];

  const points: SignupPoint[] = [];
  for (let cursor = new Date(`${dayKey(first)}T00:00:00.000Z`); dayKey(cursor) <= dayKey(last); cursor = addDays(cursor, 1)) {
    points.push({ key: dayKey(cursor), count: counts.get(dayKey(cursor)) ?? 0 });
    if (points.length >= MAX_POINTS) break;
  }
  return points;
}

// ── Daily metric series, from the admin-stats `daily` payload ─────────────

/** A role bucket ('profiles', 'jobs', 'job_seeker', 'none'), or 'all'. */
export type PersonaFilter = string;

/** One day: `date`, then one object of metric counts per role bucket. */
export type DailyRow = { date: string; [bucket: string]: Record<string, number> | string };

/**
 * One point per day for a single metric (or the sum of several), gap-filled
 * across the window.
 *
 * 'all' sums every bucket, including accounts with no role yet, so the role
 * splits can legitimately total less than all. Folding those into one of the
 * splits would invent a role the account never chose.
 */
export function buildMetricSeries(
  rows: DailyRow[],
  metric: string | string[],
  persona: PersonaFilter,
  startDate: string | null,
  endDate: string | null,
  now: Date = new Date(),
): SignupPoint[] {
  const counts = new Map<string, number>();
  let earliest: string | null = null;
  const metrics = Array.isArray(metric) ? metric : [metric];

  const fromKey = startDate ? dayKey(new Date(startDate)) : null;
  const toKey = endDate ? dayKey(new Date(endDate)) : null;

  for (const row of rows) {
    if (!row?.date) continue;
    if (fromKey && row.date < fromKey) continue;
    if (toKey && row.date > toKey) continue;
    let value = 0;
    for (const [bucket, byMetric] of Object.entries(row)) {
      if (bucket === 'date' || typeof byMetric !== 'object' || byMetric === null) continue;
      if (persona !== 'all' && bucket !== persona) continue;
      for (const key of metrics) value += Number(byMetric[key] ?? 0);
    }
    counts.set(row.date, (counts.get(row.date) ?? 0) + value);
    if (!earliest || row.date < earliest) earliest = row.date;
  }

  const firstKey = fromKey ?? earliest;
  if (!firstKey) return [];
  const lastKey = toKey ?? dayKey(now);
  if (lastKey < firstKey) return [];

  const points: SignupPoint[] = [];
  for (let cursor = new Date(`${firstKey}T00:00:00.000Z`); dayKey(cursor) <= lastKey; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = dayKey(cursor);
    points.push({ key, count: counts.get(key) ?? 0 });
    if (points.length >= MAX_POINTS) break;
  }
  return points;
}
