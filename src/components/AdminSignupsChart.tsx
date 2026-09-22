import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { buildSignupSeries } from '../lib/admin-signups-series';

type Props = {
  /** Every account in the dashboard, unfiltered. Bucketing happens here. */
  accounts: Array<{ created_at: string }>;
  /** ISO timestamps from the dashboard's date picker. Null means open-ended. */
  startDate: string | null;
  endDate: string | null;
  rangeLabel: string;
};

const CHART_W = 900;
const CHART_H = 180;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 22;

export default function AdminSignupsChart({ accounts, startDate, endDate, rangeLabel }: Props) {
  const series = useMemo(
    () => buildSignupSeries(accounts, startDate, endDate),
    [accounts, startDate, endDate],
  );

  const total = series.reduce((sum, p) => sum + p.count, 0);
  const peak = series.reduce((best, p) => (p.count > best.count ? p : best), { key: '', count: 0 });
  // A flat line of zeros still needs a sane axis, and the top gridline should
  // not sit exactly on the tallest point.
  const yMax = Math.max(1, peak.count);

  const x = (index: number) =>
    series.length <= 1
      ? PAD_L + (CHART_W - PAD_L - PAD_R) / 2
      : PAD_L + (index * (CHART_W - PAD_L - PAD_R)) / (series.length - 1);
  const y = (count: number) => PAD_T + (1 - count / yMax) * (CHART_H - PAD_T - PAD_B);

  const linePath = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ');
  const areaPath = series.length
    ? `${linePath} L${x(series.length - 1).toFixed(1)},${CHART_H - PAD_B} L${x(0).toFixed(1)},${CHART_H - PAD_B} Z`
    : '';

  const formatDay = (key: string) =>
    new Date(`${key}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // Roughly six labels however long the range is, so 90 days does not render
  // ninety overlapping dates.
  const tickEvery = Math.max(1, Math.ceil(series.length / 6));

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Daily signups</h2>
          <span className="text-[10px] text-gray-400">{rangeLabel}</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-gray-500">
          <span><span className="font-semibold tabular-nums text-gray-900">{total.toLocaleString()}</span> total</span>
          {peak.count > 0 && (
            <span>peak <span className="font-semibold tabular-nums text-gray-900">{peak.count}</span> on {formatDay(peak.key)}</span>
          )}
        </div>
      </div>

      {series.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-gray-400">No signups in this range.</p>
      ) : (
        <div className="px-2 py-3">
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="h-44 w-full" role="img" aria-label={`Daily signups, ${total} total`}>
            {[0, 0.5, 1].map((fraction) => {
              const value = Math.round(yMax * (1 - fraction));
              const gy = PAD_T + fraction * (CHART_H - PAD_T - PAD_B);
              return (
                <g key={fraction}>
                  <line x1={PAD_L} y1={gy} x2={CHART_W - PAD_R} y2={gy} stroke="#f1f5f9" strokeWidth={1} />
                  <text x={PAD_L - 6} y={gy + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: 9 }}>
                    {value}
                  </text>
                </g>
              );
            })}

            <path d={areaPath} fill="url(#signupFill)" />
            <defs>
              <linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={linePath} fill="none" stroke="#2563eb" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />

            {series.map((point, i) => (
              <g key={point.key}>
                {/* Full-height hit area: hovering a 3px dot on a 90-day range
                    is not realistic, so the whole column is the target. */}
                <rect
                  x={x(i) - (CHART_W - PAD_L - PAD_R) / Math.max(series.length, 1) / 2}
                  y={PAD_T}
                  width={(CHART_W - PAD_L - PAD_R) / Math.max(series.length, 1)}
                  height={CHART_H - PAD_T - PAD_B}
                  fill="transparent"
                >
                  <title>{`${formatDay(point.key)} — ${point.count} signup${point.count === 1 ? '' : 's'}`}</title>
                </rect>
                {(point.count > 0 && (series.length <= 60 || point.count === peak.count)) && (
                  <circle cx={x(i)} cy={y(point.count)} r={2.5} fill="#2563eb" />
                )}
              </g>
            ))}

            {series.map((point, i) => (
              i % tickEvery === 0 || i === series.length - 1 ? (
                <text
                  key={`tick-${point.key}`}
                  x={x(i)}
                  y={CHART_H - 6}
                  textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
                  className="fill-gray-400"
                  style={{ fontSize: 9 }}
                >
                  {formatDay(point.key)}
                </text>
              ) : null
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
