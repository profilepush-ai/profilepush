import { useEffect, useState } from 'react';
import { Briefcase, Check, ChevronDown, Clock3, Download, MessageSquare, UserRound } from 'lucide-react';
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

type JobsFunnelTrend = {
  received_funnel: { posted: number; previewed: number; applied: number; screening_completed: number; qualified: number; rejected: number };
  sent_funnel: { revealed: number; breakdown_viewed: number; submitted: number; screening_completed: number; qualified: number };
  conversations: number;
  active_list_downloaded: number;
  daily: Array<{ date: string; previews: number; applications: number; revealed: number; submitted: number }>;
};

type HotlistFunnelTrend = {
  received_funnel: { posted: number; previewed: number; requested: number; fulfilled: number };
  sent_funnel: { revealed: number; breakdown_viewed: number; requested: number; fulfilled: number };
  conversations: number;
  active_list_downloaded: number;
  daily: Array<{ date: string; previews: number; requests: number; revealed: number; sent_requests: number }>;
};

function SmallStat({ icon: Icon, label, value }: { icon: typeof MessageSquare; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2">
      <Icon size={13} className="text-gray-400" />
      <div>
        <p className="text-[13px] font-bold text-gray-900">{value}</p>
        <p className="text-[10px] text-gray-500">{label}</p>
      </div>
    </div>
  );
}

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

  const jobsReceivedStages = [
    { label: 'Posted', value: jobsTrend?.received_funnel.posted ?? 0 },
    { label: 'Previewed', value: jobsTrend?.received_funnel.previewed ?? 0 },
    { label: 'Applied', value: jobsTrend?.received_funnel.applied ?? 0 },
    { label: 'Screening Done', value: jobsTrend?.received_funnel.screening_completed ?? 0 },
    { label: 'Qualified', value: jobsTrend?.received_funnel.qualified ?? 0 },
  ];
  const jobsSentStages = [
    { label: 'Revealed', value: jobsTrend?.sent_funnel.revealed ?? 0 },
    { label: 'Breakdown', value: jobsTrend?.sent_funnel.breakdown_viewed ?? 0 },
    { label: 'Submitted', value: jobsTrend?.sent_funnel.submitted ?? 0 },
    { label: 'Screening Done', value: jobsTrend?.sent_funnel.screening_completed ?? 0 },
    { label: 'Qualified', value: jobsTrend?.sent_funnel.qualified ?? 0 },
  ];

  const hotlistReceivedStages = [
    { label: 'Posted', value: hotlistTrend?.received_funnel.posted ?? 0 },
    { label: 'Previewed', value: hotlistTrend?.received_funnel.previewed ?? 0 },
    { label: 'Requested', value: hotlistTrend?.received_funnel.requested ?? 0 },
    { label: 'Fulfilled', value: hotlistTrend?.received_funnel.fulfilled ?? 0 },
  ];
  const hotlistSentStages = [
    { label: 'Revealed', value: hotlistTrend?.sent_funnel.revealed ?? 0 },
    { label: 'Breakdown', value: hotlistTrend?.sent_funnel.breakdown_viewed ?? 0 },
    { label: 'Requested', value: hotlistTrend?.sent_funnel.requested ?? 0 },
    { label: 'Fulfilled', value: hotlistTrend?.sent_funnel.fulfilled ?? 0 },
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
                    <p className="text-[11px] text-gray-400">{jobsTrend?.received_funnel.posted ?? 0} posted in {range.label.toLowerCase()}</p>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-2">
                  <SmallStat icon={MessageSquare} label="Conversations" value={jobsTrend?.conversations ?? 0} />
                  <SmallStat icon={Download} label="Vendor contacts downloaded" value={jobsTrend?.active_list_downloaded ?? 0} />
                </div>

                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Received — from Posts</p>
                <FunnelChart stages={jobsReceivedStages} color="#2563eb" />
                {(jobsTrend?.received_funnel.rejected ?? 0) > 0 && (
                  <p className="mt-2 text-[11px] text-gray-400">{jobsTrend?.received_funnel.rejected} rejected in this period</p>
                )}

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Sent — from Feed &amp; Tracker</p>
                <FunnelChart stages={jobsSentStages} color="#0d9488" />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Daily Trend</p>
                <DailyBarChart
                  data={jobsTrend?.daily ?? []}
                  series={[
                    { key: 'previews', label: 'Previews', color: '#93c5fd' },
                    { key: 'applications', label: 'Applications', color: '#2563eb' },
                    { key: 'revealed', label: 'Revealed', color: '#5eead4' },
                    { key: 'submitted', label: 'Submitted', color: '#0d9488' },
                  ]}
                />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Activity Heatmap</p>
                <HeatmapStrip data={jobsTrend?.daily ?? []} valueKeys={['previews', 'applications', 'revealed', 'submitted']} color="#2563eb" />
              </section>

              {/* Hotlist column */}
              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-4 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-purple-50 text-purple-700">
                    <UserRound size={15} />
                  </span>
                  <div>
                    <p className="text-[14px] font-bold text-gray-900">Hotlist</p>
                    <p className="text-[11px] text-gray-400">{hotlistTrend?.received_funnel.posted ?? 0} posted in {range.label.toLowerCase()}</p>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-2">
                  <SmallStat icon={MessageSquare} label="Conversations" value={hotlistTrend?.conversations ?? 0} />
                  <SmallStat icon={Download} label="Recruiter contacts downloaded" value={hotlistTrend?.active_list_downloaded ?? 0} />
                </div>

                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Received — from Posts</p>
                <FunnelChart stages={hotlistReceivedStages} color="#9333ea" />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Sent — from Feed &amp; Tracker</p>
                <FunnelChart stages={hotlistSentStages} color="#db2777" />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Daily Trend</p>
                <DailyBarChart
                  data={hotlistTrend?.daily ?? []}
                  series={[
                    { key: 'previews', label: 'Previews', color: '#d8b4fe' },
                    { key: 'requests', label: 'Requests', color: '#9333ea' },
                    { key: 'revealed', label: 'Revealed', color: '#fbcfe8' },
                    { key: 'sent_requests', label: 'Sent Requests', color: '#db2777' },
                  ]}
                />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Activity Heatmap</p>
                <HeatmapStrip data={hotlistTrend?.daily ?? []} valueKeys={['previews', 'requests', 'revealed', 'sent_requests']} color="#9333ea" />
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
