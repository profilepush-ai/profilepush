import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  buildFunnel,
  creditBands,
  formatRate,
  personaLess,
  signupsInRange,
  worstStep,
  type FunnelAccount,
  type FunnelStage,
  type Persona,
} from '../lib/admin-funnel';

type Props = {
  accounts: FunnelAccount[];
  startDate: string | null;
  endDate: string | null;
  rangeLabel: string;
};

const PERSONA_LABEL: Record<Persona, string> = {
  vendor: 'Vendors',
  bench_sales: 'Bench Sales',
};

const PERSONA_ACCENT: Record<Persona, string> = {
  vendor: 'bg-blue-500',
  bench_sales: 'bg-emerald-500',
};

// Recharts takes a colour value, not a class.
const PERSONA_HEX: Record<Persona, string> = {
  vendor: '#3b82f6',
  bench_sales: '#10b981',
};

function FunnelColumn({ persona, stages, rangeLabel }: { persona: Persona; stages: FunnelStage[]; rangeLabel: string }) {
  const top = stages[0]?.count ?? 0;
  const worst = worstStep(stages);

  // Labels sit outside the shape, not inside it. Inside only works when a
  // funnel tapers gently; this one can go to zero in a single step, and then
  // every band is a sliver with text stacked on top of itself.
  //
  // Each row draws its own trapezoid, from this stage's share to the next
  // stage's, so consecutive rows join into one continuous taper.
  const ROW_H = 44;
  const W = 100;
  const widthAt = (index: number) => {
    const stage = stages[index];
    if (!stage) return 0;
    // A stage nobody reached still needs a visible neck, or the funnel just
    // stops and the rows below look like a rendering bug.
    return Math.max(4, stage.overallRate * W);
  };

  return (
    <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white">
      <div className="flex items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${PERSONA_ACCENT[persona]}`} />
          <h2 className="text-sm font-semibold text-gray-900">{PERSONA_LABEL[persona]}</h2>
        </div>
        <span className="text-[10px] text-gray-400">{rangeLabel}</span>
      </div>

      {top === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-gray-400">No {PERSONA_LABEL[persona].toLowerCase()} signed up in this range.</p>
      ) : (
        <div className="px-3 py-2">
          {stages.map((stage, index) => {
            const wTop = widthAt(index);
            const wBottom = index === stages.length - 1 ? wTop * 0.75 : widthAt(index + 1);
            const isWorst = worst?.key === stage.key;
            const empty = stage.count === 0;
            return (
              <div key={stage.key}>
                <div className="flex items-stretch" style={{ height: ROW_H }}>
                  <div className="flex w-[104px] shrink-0 items-center justify-end pr-2 sm:w-[128px]">
                    <span className={`truncate text-right text-[11px] leading-tight ${isWorst ? 'font-semibold text-red-600' : 'text-gray-600'}`}>
                      {stage.label}
                    </span>
                  </div>

                  <div className="relative min-w-0 flex-1">
                    <svg viewBox={`0 0 ${W} ${ROW_H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
                      <polygon
                        points={`${(W - wTop) / 2},0 ${(W + wTop) / 2},0 ${(W + wBottom) / 2},${ROW_H} ${(W - wBottom) / 2},${ROW_H}`}
                        fill={empty ? '#e5e7eb' : PERSONA_HEX[persona]}
                        opacity={empty ? 1 : 1 - index * 0.1}
                      />
                    </svg>
                  </div>

                  <div className="flex w-[84px] shrink-0 flex-col items-end justify-center pl-2">
                    <span className="text-sm font-semibold leading-none tabular-nums text-gray-900">{stage.count}</span>
                    {index > 0 && (
                      <span className="mt-0.5 text-[10px] leading-none text-gray-400">{formatRate(stage.overallRate)} of top</span>
                    )}
                  </div>
                </div>

                {index < stages.length - 1 && (
                  <div className="flex items-center" style={{ height: 18 }}>
                    <div className="w-[104px] shrink-0 sm:w-[128px]" />
                    <div className="min-w-0 flex-1 text-center">
                      <span className={`text-[10px] ${worst?.key === stages[index + 1].key ? 'font-semibold text-red-600' : 'text-gray-400'}`}>
                        {formatRate(stages[index + 1].stepRate)} continue
                        {stages[index + 1].dropped > 0 ? ` · ${stages[index + 1].dropped} lost` : ''}
                        {worst?.key === stages[index + 1].key ? ' · biggest drop' : ''}
                      </span>
                    </div>
                    <div className="w-[84px] shrink-0" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Ga4Day = { date: string; sessions: number; visitors: number; signup_page_views: number; signup_page_visitors: number };
type Ga4State = { connected: boolean; reason?: string; daily: Ga4Day[] };

export default function AdminFunnels({ accounts, startDate, endDate, rangeLabel }: Props) {
  const [ga4, setGa4] = useState<Ga4State>({ connected: false, daily: [] });

  const loadGa4 = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-ga4', {
        body: {
          password: sessionStorage.getItem('admin_authed') || '',
          start_date: startDate,
          end_date: endDate,
        },
      });
      if (error) throw new Error(error.message);
      setGa4({ connected: Boolean(data?.connected), reason: data?.reason, daily: data?.daily ?? [] });
    } catch (err) {
      // Not connected is the normal state until the secrets are set, so this
      // reports rather than throws — the rest of the funnel is unaffected.
      setGa4({ connected: false, reason: (err as Error).message, daily: [] });
    }
  }, [startDate, endDate]);

  useEffect(() => { void loadGa4(); }, [loadGa4]);

  const ga4Totals = useMemo(() => ga4.daily.reduce(
    (total, day) => ({
      visitors: total.visitors + (day.visitors ?? 0),
      signupPage: total.signupPage + (day.signup_page_visitors ?? 0),
    }),
    { visitors: 0, signupPage: 0 },
  ), [ga4.daily]);
  const credits = useMemo(() => creditBands(accounts, startDate, endDate), [accounts, startDate, endDate]);
  const vendor = useMemo(() => buildFunnel(accounts, 'vendor', startDate, endDate), [accounts, startDate, endDate]);
  const bench = useMemo(() => buildFunnel(accounts, 'bench_sales', startDate, endDate), [accounts, startDate, endDate]);
  const signups = useMemo(() => signupsInRange(accounts, startDate, endDate), [accounts, startDate, endDate]);
  const undecided = useMemo(() => personaLess(accounts, startDate, endDate), [accounts, startDate, endDate]);

  return (
    <div className="space-y-3">
      {ga4.connected ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase text-gray-500">Website visitors</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{ga4Totals.visitors.toLocaleString()}</p>
            <p className="mt-0.5 text-[10px] text-gray-400">Google Analytics · {rangeLabel}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase text-gray-500">Reached signup page</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{ga4Totals.signupPage.toLocaleString()}</p>
            <p className="mt-0.5 text-[10px] text-gray-400">
              {ga4Totals.visitors > 0 ? formatRate(ga4Totals.signupPage / ga4Totals.visitors) : '—'} of visitors
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase text-gray-500">Visitor to signup</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
              {ga4Totals.visitors > 0 ? formatRate(signups / ga4Totals.visitors) : '—'}
            </p>
            <p className="mt-0.5 text-[10px] text-gray-400">the rate the growth plan rests on</p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-gray-400" />
            <div className="min-w-0 text-xs text-gray-600">
              <p className="font-semibold text-gray-700">Website and signup-page visits are not connected.</p>
              <p className="mt-0.5">
                {ga4.reason ?? 'Google Analytics is not reachable from this dashboard.'} Set{' '}
                <code>GA4_PROPERTY_ID</code>, <code>GA4_CLIENT_EMAIL</code> and <code>GA4_PRIVATE_KEY</code> on the{' '}
                <code>admin-ga4</code> function, and give that service account Viewer access on the GA4 property.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase text-gray-500">Signed up</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{signups.toLocaleString()}</p>
          <p className="mt-0.5 text-[10px] text-gray-400">{rangeLabel}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase text-gray-500">Chose a persona</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
            {(vendor[0]?.count ?? 0) + (bench[0]?.count ?? 0)}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400">
            {signups > 0 ? formatRate(((vendor[0]?.count ?? 0) + (bench[0]?.count ?? 0)) / signups) : '—'} of signups
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase text-gray-500">Never chose one</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${undecided > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {undecided.toLocaleString()}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400">in neither funnel below</p>
        </div>
      </div>

      {/* Credit usage sits beside the funnel, not in it. As stages these read
          zero everywhere, because a cumulative funnel makes each step a subset
          of the one above and the people burning credits are not, yet, the
          people sending — of the accounts past a tenth of the grant in a
          recent week, none had sent anything. That is worth seeing, and a
          stage that can only ever be zero hides it. */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase text-gray-500">
          Credit usage · share of each account's signup grant
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {credits.map((band) => (
            <div key={band.pct} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase text-gray-500">{band.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{band.count.toLocaleString()}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">{formatRate(band.share)} of signups</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <FunnelColumn persona="vendor" stages={vendor} rangeLabel={rangeLabel} />
        <FunnelColumn persona="bench_sales" stages={bench} rangeLabel={rangeLabel} />
      </div>
    </div>
  );
}
