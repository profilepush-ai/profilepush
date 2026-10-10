import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import LogoSpinner from './LogoSpinner';
import { supabase } from '../lib/supabase';

type Stats = {
  days: number;
  revenue: { window_inr: number; all_time_inr: number; orders_window: number; payers_all_time: number; abandoned_window: number };
  matches: { charged: number; ai_match_credits: number; refunded: number; accounts_charged: number; waiting: number; waiting_accounts: number };
  funnel: { signups: number; got_matches: number; ran_out: number; paid: number; zero_balance_all: number };
  daily: Array<{ day: string; matches: number; revenue_inr: number; signups: number }>;
  top_accounts: Array<{ id: string; name: string | null; balance: number; matches: number; paid: boolean; waiting: number }>;
  matcher: { last_run_at: string | null; last_status: string | null; last_seconds: number | null; failed_24h: number; runs_24h: number };
};

const RANGES = [7, 30, 90];
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const num = (n: number) => Math.round(n).toLocaleString('en-IN');

function Tile({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const toneCls = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-700' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-[22px] font-bold tabular-nums ${toneCls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] text-gray-500">{sub}</p>}
    </div>
  );
}

// Daily matches charged as bars, revenue as a marker on the same day. One
// axis per chart: revenue days are labelled rather than drawn on a second scale.
function DailyBars({ daily }: { daily: Stats['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.matches));
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-semibold text-gray-900">Matches charged per day</p>
        <p className="text-[11px] text-gray-500"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />day with revenue</p>
      </div>
      <div className="mt-3 flex h-36 items-end gap-[2px]">
        {daily.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className="w-full rounded-t-[4px] bg-blue-500 transition-colors group-hover:bg-blue-700" style={{ height: `${(d.matches / max) * 100}%`, minHeight: d.matches ? 2 : 0 }} />
            {d.revenue_inr > 0 && <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-emerald-500 ring-2 ring-white" />}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] text-white group-hover:block">
              {new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: {num(d.matches)} matches · {inr(d.revenue_inr)} · {d.signups} signups
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-gray-400">
        <span>{daily[0] && new Date(daily[0].day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span>max {num(max)}/day</span>
        <span>today</span>
      </div>
    </div>
  );
}

export default function AdminRevenuePanel() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: fnError } = await supabase.functions.invoke('admin-revenue', {
      body: { password: sessionStorage.getItem('admin_authed') || '', days },
    });
    if (fnError || data?.error) setError(data?.error || fnError?.message || 'Could not load');
    else setStats(data as Stats);
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const f = stats?.funnel;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–');

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">Revenue and matches</p>
          <p className="text-[11px] text-gray-500">Customer accounts only (internal accounts left out). 1 credit = 1 match = ₹0.25.</p>
        </div>
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <button key={r} type="button" onClick={() => setDays(r)}
              className={`h-8 rounded-md border px-3 text-xs font-semibold ${days === r ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {r} days
            </button>
          ))}
          <button type="button" onClick={() => void load()} disabled={loading} title="Refresh" className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {loading && !stats && <div className="flex justify-center py-10"><LogoSpinner size={18} /></div>}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label={`Revenue · ${stats.days}d`} value={inr(stats.revenue.window_inr)} sub={`${stats.revenue.orders_window} paid top-ups · ${stats.revenue.abandoned_window} not completed`} tone={stats.revenue.window_inr > 0 ? 'good' : 'default'} />
            <Tile label="Paying accounts" value={num(stats.revenue.payers_all_time)} sub={`${inr(stats.revenue.all_time_inr)} all time`} />
            <Tile label={`Matches charged · ${stats.days}d`} value={num(stats.matches.charged)} sub={`${num(stats.matches.ai_match_credits)} AI Match credits · ${stats.matches.refunded} refunded`} />
            <Tile label="Waiting matches" value={num(stats.matches.waiting)} sub={`${stats.matches.waiting_accounts} accounts out of credits · ${stats.funnel.zero_balance_all} at zero`} tone={stats.matches.waiting > 0 ? 'warn' : 'default'} />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-[13px] font-semibold text-gray-900">Signups in the last {stats.days} days</p>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {f && [
                ['Signed up', f.signups, ''],
                ['Got matches', f.got_matches, pct(f.got_matches, f.signups)],
                ['Ran out', f.ran_out, pct(f.ran_out, f.signups)],
                ['Paid', f.paid, pct(f.paid, f.signups)],
              ].map(([label, n, p], i) => (
                <div key={String(label)} className="rounded-md bg-gray-50 px-2 py-3">
                  <p className="text-[11px] font-medium text-gray-500">{i + 1}. {label}</p>
                  <p className="mt-1 text-[20px] font-bold tabular-nums text-gray-900">{num(Number(n))}</p>
                  <p className="text-[11px] tabular-nums text-gray-400">{p || ' '}</p>
                </div>
              ))}
            </div>
          </div>

          <DailyBars daily={stats.daily} />

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <p className="border-b border-gray-100 px-4 py-2.5 text-[13px] font-semibold text-gray-900">Top accounts by matches · {stats.days}d</p>
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-400">
                  <tr><th className="px-3 py-2 font-medium">Account</th><th className="px-3 py-2 text-right font-medium">Matches</th><th className="px-3 py-2 text-right font-medium">Balance</th><th className="px-3 py-2 text-right font-medium">Waiting</th><th className="px-3 py-2 font-medium">Plan</th></tr>
                </thead>
                <tbody>
                  {stats.top_accounts.map((a) => (
                    <tr key={a.id} className="border-t border-gray-100">
                      <td className="max-w-[220px] truncate px-3 py-2 text-gray-800">{a.name || a.id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(a.matches)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${a.balance < 1 ? 'font-semibold text-red-600' : ''}`}>{num(a.balance)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.waiting || '–'}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${a.paid ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{a.paid ? 'Paid' : 'Free'}</span></td>
                    </tr>
                  ))}
                  {stats.top_accounts.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No matches charged in this period.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-[13px] font-semibold text-gray-900">Matcher health</p>
              <dl className="mt-2 space-y-1.5 text-[12px]">
                <div className="flex justify-between"><dt className="text-gray-500">Last run</dt><dd className="tabular-nums">{stats.matcher.last_run_at ? new Date(stats.matcher.last_run_at).toLocaleTimeString() : '–'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Status</dt><dd className={`font-semibold ${stats.matcher.last_status === 'succeeded' ? 'text-emerald-700' : 'text-red-700'}`}>{stats.matcher.last_status ?? '–'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Took</dt><dd className="tabular-nums">{stats.matcher.last_seconds != null ? `${stats.matcher.last_seconds}s of 120s` : '–'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Failed, 24h</dt><dd className={`tabular-nums ${stats.matcher.failed_24h ? 'font-semibold text-red-700' : ''}`}>{stats.matcher.failed_24h} of {stats.matcher.runs_24h}</dd></div>
              </dl>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
