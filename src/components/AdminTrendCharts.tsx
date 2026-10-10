import { useMemo } from 'react';
import AdminLineChart from './AdminLineChart';
import AdminDailyBriefing from './AdminDailyBriefing';
import { buildTargetSeries, SIGNUPS_BASE_TARGET } from '../lib/admin-targets';
import type { BriefLine, MetricSeries } from '../lib/admin-briefing';
import { buildMetricSeries, type DailyRow } from '../lib/admin-signups-series';
import type { RoleFilter } from '../lib/admin-account-stats';

type Props = {
  /** Daily buckets from admin-stats, per role. */
  daily: DailyRow[];
  role: RoleFilter;
  startDate: string | null;
  endDate: string | null;
  rangeLabel: string;
  /** Known breakages, shown above anything the data can infer. */
  blockers?: BriefLine[];
};

// In the order the product runs: people arrive, get matches, watch them,
// apply, hear back, and pay.
const METRICS: Array<{ key: string; metric: string | string[]; title: string; base?: number }> = [
  { key: 'signups', metric: 'signups', title: 'Daily signups', base: SIGNUPS_BASE_TARGET },
  { key: 'active_users', metric: 'active_users', title: 'Daily active users' },
  { key: 'matches', metric: 'matches', title: 'Matches sent' },
  { key: 'watched', metric: 'watched', title: 'Matches watched' },
  { key: 'applied', metric: ['applied_email', 'applied_site', 'ask_resume'], title: 'Applied (email, site, Ask Resume)' },
  { key: 'replies', metric: 'replies', title: 'Replies' },
  { key: 'interviews', metric: 'interviews', title: 'Interviews' },
  { key: 'placed', metric: 'placed', title: 'Placed' },
  { key: 'paid_orders', metric: 'paid_orders', title: 'Paid orders' },
  { key: 'revenue_inr', metric: 'revenue_inr', title: 'Revenue ₹' },
  { key: 'revenue_usd', metric: 'revenue_usd', title: 'Revenue $' },
  { key: 'ai_apply_fills', metric: 'ai_apply_fills', title: 'AI Apply fills' },
  { key: 'referrals', metric: 'referrals', title: 'Referrals' },
];

export default function AdminTrendCharts({ daily, role, startDate, endDate, rangeLabel, blockers = [] }: Props) {
  const series: MetricSeries[] = useMemo(
    () => METRICS.map((m) => {
      const points = buildMetricSeries(daily, m.metric, role, startDate, endDate);
      return { key: m.key, title: m.title, points, targets: buildTargetSeries(points, m.base) };
    }),
    [daily, role, startDate, endDate],
  );

  const hasAnything = series.some((m) => m.points.some((p) => p.count > 0));

  return (
    <div className="space-y-3">
      <AdminDailyBriefing metrics={series} blockers={blockers} />

      {!hasAnything ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
          No activity in this range.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {series.map((metric) => (
            <AdminLineChart
              key={metric.key}
              title={metric.title}
              points={metric.points}
              targetPoints={metric.targets}
              rangeLabel={rangeLabel}
              emptyLabel={metric.key === 'signups' ? 'No signups in this range.' : undefined}
              dense
            />
          ))}
        </div>
      )}
    </div>
  );
}
