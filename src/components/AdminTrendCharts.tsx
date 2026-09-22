import { useMemo, useState } from 'react';
import AdminLineChart from './AdminLineChart';
import {
  buildMetricSeries,
  buildSignupSeries,
  type DailyRow,
  type PersonaFilter,
} from '../lib/admin-signups-series';

type Props = {
  /** Raw daily buckets from admin-stats. */
  daily: DailyRow[];
  /** Accounts, for the signups line — created_at is not in the daily payload. */
  accounts: Array<{ created_at: string }>;
  startDate: string | null;
  endDate: string | null;
  rangeLabel: string;
};

const PERSONAS: Array<{ key: PersonaFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'vendor', label: 'Vendors' },
  { key: 'bench_sales', label: 'Bench Sales' },
];

// Ordered by what gets looked at first, not alphabetically. Active users and
// signups answer "is the platform growing"; the rest answer "what are they
// doing".
const METRICS: Array<{ key: string; title: string }> = [
  { key: 'active_users', title: 'Daily active users' },
  { key: 'ai_pitches', title: 'AI pitches' },
  { key: 'ai_requests', title: 'AI requests' },
  { key: 'ai_matches', title: 'AI matches delivered' },
  { key: 'job_posts', title: 'Job posts' },
  { key: 'hotlist_posts', title: 'Hotlist posts' },
  { key: 'previews', title: 'Post previews' },
  { key: 'searches', title: 'Searches' },
  { key: 'chats', title: 'Chats' },
  { key: 'downloads', title: 'List downloads' },
];

export default function AdminTrendCharts({ daily, accounts, startDate, endDate, rangeLabel }: Props) {
  const [persona, setPersona] = useState<PersonaFilter>('all');

  // Signups come from the accounts array rather than the daily payload, so
  // that the persona split uses the account's persona as it is now — which is
  // the only persona a signup can be attributed to anyway.
  const signupPoints = useMemo(() => {
    const scoped = persona === 'all'
      ? accounts
      : accounts.filter((a) => (a as { active_persona?: string | null }).active_persona === persona);
    return buildSignupSeries(scoped, startDate, endDate);
  }, [accounts, persona, startDate, endDate]);

  const series = useMemo(
    () => METRICS.map((metric) => ({
      ...metric,
      points: buildMetricSeries(daily, metric.key, persona, startDate, endDate),
    })),
    [daily, persona, startDate, endDate],
  );

  const hasAnything = signupPoints.some((p) => p.count > 0) || series.some((m) => m.points.some((p) => p.count > 0));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-gray-300 bg-white p-0.5">
          {PERSONAS.map((option) => (
            <button
              key={option.key}
              onClick={() => setPersona(option.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                persona === option.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-gray-400">{rangeLabel}</span>
        {persona !== 'all' && (
          // Said plainly because the numbers otherwise look like a bug: the
          // two splits do not add up to All when accounts have no persona set.
          <span className="text-[11px] text-gray-400">
            accounts with no persona set are excluded from this split
          </span>
        )}
      </div>

      {!hasAnything ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">
          No activity in this range.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <AdminLineChart title="Daily signups" points={signupPoints} rangeLabel={rangeLabel} emptyLabel="No signups in this range." dense />
          {series.map((metric) => (
            <AdminLineChart key={metric.key} title={metric.title} points={metric.points} rangeLabel={rangeLabel} dense />
          ))}
        </div>
      )}
    </div>
  );
}
