import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import FunnelSankey from './FunnelSankey';
import {
  buildFunnelFlow,
  formatRate,
  personaLess,
  signupsInRange,
  type FunnelAccount,
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
  const vendorFlow = useMemo(() => buildFunnelFlow(accounts, 'vendor', startDate, endDate), [accounts, startDate, endDate]);
  const benchFlow = useMemo(() => buildFunnelFlow(accounts, 'bench_sales', startDate, endDate), [accounts, startDate, endDate]);
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
            {vendorFlow.cohort + benchFlow.cohort}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400">
            {signups > 0 ? formatRate((vendorFlow.cohort + benchFlow.cohort) / signups) : '—'} of signups
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

      {/* One funnel, branching. A second non-branching copy underneath is
          just the flat version again, and two funnels of the same data on one
          screen invite reading the wrong one. */}
      {/* Stacked, not side by side: a left-to-right flow with six columns
          needs the full width to stay readable. */}
      <div className="grid gap-3">
        <FunnelSankey flow={vendorFlow} hex={PERSONA_HEX.vendor} personaLabel={PERSONA_LABEL.vendor} accent={PERSONA_ACCENT.vendor} rangeLabel={rangeLabel} />
        <FunnelSankey flow={benchFlow} hex={PERSONA_HEX.bench_sales} personaLabel={PERSONA_LABEL.bench_sales} accent={PERSONA_ACCENT.bench_sales} rangeLabel={rangeLabel} />
      </div>
    </div>
  );
}
