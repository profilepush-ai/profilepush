import { useEffect, useState } from 'react';
import { Briefcase, Check, ChevronDown, Clock3, UserRound } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { DailyBarChart, FunnelChart, HeatmapStrip } from '../components/charts/DashboardCharts';

const RANGE_OPTIONS: Array<{ id: string; label: string; days: number }> = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
];

type DailyRow = { date: string; previews: number; applications?: number; requests?: number };

type JobsFunnelTrend = {
  funnel: { posted: number; previewed: number; applied: number; screening_completed: number; qualified: number; rejected: number };
  daily: DailyRow[];
};

type HotlistFunnelTrend = {
  funnel: { posted: number; previewed: number; requested: number; fulfilled: number };
  daily: DailyRow[];
};

export default function DashboardPage() {
  const { account } = useAuth();
  const [rangeId, setRangeId] = useState('7d');
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [jobsTrend, setJobsTrend] = useState<JobsFunnelTrend | null>(null);
  const [hotlistTrend, setHotlistTrend] = useState<HotlistFunnelTrend | null>(null);

  const range = RANGE_OPTIONS.find((option) => option.id === rangeId) ?? RANGE_OPTIONS[0];

  useEffect(() => {
    if (!account?.id) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      const [jobsResult, hotlistResult] = await Promise.all([
        supabase.rpc('get_account_jobs_funnel_trend' as never, { p_days: range.days } as never) as unknown as
          Promise<{ data: JobsFunnelTrend | null }>,
        supabase.rpc('get_account_hotlist_funnel_trend' as never, { p_days: range.days } as never) as unknown as
          Promise<{ data: HotlistFunnelTrend | null }>,
      ]);
      if (cancelled) return;
      if (jobsResult.data) setJobsTrend(jobsResult.data);
      if (hotlistResult.data) setHotlistTrend(hotlistResult.data);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [account?.id, range.days]);

  const jobsFunnelStages = [
    { label: 'Posted', value: jobsTrend?.funnel.posted ?? 0 },
    { label: 'Previewed', value: jobsTrend?.funnel.previewed ?? 0 },
    { label: 'Applied', value: jobsTrend?.funnel.applied ?? 0 },
    { label: 'Screening Done', value: jobsTrend?.funnel.screening_completed ?? 0 },
    { label: 'Qualified', value: jobsTrend?.funnel.qualified ?? 0 },
  ];

  const hotlistFunnelStages = [
    { label: 'Posted', value: hotlistTrend?.funnel.posted ?? 0 },
    { label: 'Previewed', value: hotlistTrend?.funnel.previewed ?? 0 },
    { label: 'Requested', value: hotlistTrend?.funnel.requested ?? 0 },
    { label: 'Fulfilled', value: hotlistTrend?.funnel.fulfilled ?? 0 },
  ];

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-[#f3f2ee] text-gray-900 flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4">
          <div className="mb-4 flex items-center justify-end">
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsRangeMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                <Clock3 size={12} />
                {range.label}
                <ChevronDown size={12} />
              </button>
              {isRangeMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[160px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => { setRangeId(option.id); setIsRangeMenuOpen(false); }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[12px] font-semibold transition ${option.id === rangeId ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      <span>{option.label}</span>
                      {option.id === rangeId && <Check size={12} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <LogoSpinner size={22} />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Jobs column */}
              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-4 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                    <Briefcase size={15} />
                  </span>
                  <div>
                    <p className="text-[14px] font-bold text-gray-900">Jobs</p>
                    <p className="text-[11px] text-gray-400">{jobsTrend?.funnel.posted ?? 0} posted in {range.label.toLowerCase()}</p>
                  </div>
                </div>

                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Funnel</p>
                <FunnelChart stages={jobsFunnelStages} color="#2563eb" />
                {(jobsTrend?.funnel.rejected ?? 0) > 0 && (
                  <p className="mt-2 text-[11px] text-gray-400">{jobsTrend?.funnel.rejected} rejected in this period</p>
                )}

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Daily Trend</p>
                <DailyBarChart
                  data={jobsTrend?.daily ?? []}
                  series={[
                    { key: 'previews', label: 'Previews', color: '#93c5fd' },
                    { key: 'applications', label: 'Applications', color: '#2563eb' },
                  ]}
                />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Activity Heatmap</p>
                <HeatmapStrip data={jobsTrend?.daily ?? []} valueKeys={['previews', 'applications']} color="#2563eb" />
              </section>

              {/* Hotlist column */}
              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-4 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-purple-50 text-purple-700">
                    <UserRound size={15} />
                  </span>
                  <div>
                    <p className="text-[14px] font-bold text-gray-900">Hotlist</p>
                    <p className="text-[11px] text-gray-400">{hotlistTrend?.funnel.posted ?? 0} posted in {range.label.toLowerCase()}</p>
                  </div>
                </div>

                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Funnel</p>
                <FunnelChart stages={hotlistFunnelStages} color="#9333ea" />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Daily Trend</p>
                <DailyBarChart
                  data={hotlistTrend?.daily ?? []}
                  series={[
                    { key: 'previews', label: 'Previews', color: '#d8b4fe' },
                    { key: 'requests', label: 'Requests', color: '#9333ea' },
                  ]}
                />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Activity Heatmap</p>
                <HeatmapStrip data={hotlistTrend?.daily ?? []} valueKeys={['previews', 'requests']} color="#9333ea" />
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
