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

type VendorActivity = {
  jobs_received_funnel: { posted: number; previewed: number; applied: number; screening_completed: number; qualified: number; rejected: number };
  hotlist_sent_funnel: { requested: number; fulfilled: number };
  conversations: number;
  contacts_downloaded: number;
  daily: Array<{ date: string; previews: number; applications: number; requests: number }>;
};

type RecruiterActivity = {
  hotlist_received_funnel: { posted: number; previewed: number; requested: number; fulfilled: number };
  jobs_applying_funnel: {
    reached_out: number; progressed: number; qualified: number;
    via_submission_total: number; via_submission_screening_completed: number;
    via_outreach_total: number; via_outreach_delivered: number;
  };
  conversations: number;
  contacts_downloaded: number;
  daily: Array<{ date: string; previews: number; requests: number; submitted: number }>;
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
  const [vendorActivity, setVendorActivity] = useState<VendorActivity | null>(null);
  const [recruiterActivity, setRecruiterActivity] = useState<RecruiterActivity | null>(null);

  const range = RANGE_OPTIONS.find((option) => option.id === rangeId) ?? RANGE_OPTIONS[0];

  useEffect(() => {
    if (!account?.id) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      const vendorCall = supabase.rpc('get_account_vendor_activity' as never, { p_days: range.days } as never) as unknown as
        Promise<{ data: VendorActivity | null }>;
      const recruiterCall = supabase.rpc('get_account_recruiter_activity' as never, { p_days: range.days } as never) as unknown as
        Promise<{ data: RecruiterActivity | null }>;
      const [vendorResult, recruiterResult] = await Promise.all([vendorCall, recruiterCall]);
      if (cancelled) return;
      if (vendorResult.data) setVendorActivity(vendorResult.data);
      if (recruiterResult.data) setRecruiterActivity(recruiterResult.data);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [account?.id, range.days]);

  const vendorJobsStages = [
    { label: 'Posted', value: vendorActivity?.jobs_received_funnel.posted ?? 0 },
    { label: 'Previewed', value: vendorActivity?.jobs_received_funnel.previewed ?? 0 },
    { label: 'Applied', value: vendorActivity?.jobs_received_funnel.applied ?? 0 },
    { label: 'Screening Done', value: vendorActivity?.jobs_received_funnel.screening_completed ?? 0 },
    { label: 'Qualified', value: vendorActivity?.jobs_received_funnel.qualified ?? 0 },
  ];
  const vendorHotlistStages = [
    { label: 'Requested', value: vendorActivity?.hotlist_sent_funnel.requested ?? 0 },
    { label: 'Fulfilled', value: vendorActivity?.hotlist_sent_funnel.fulfilled ?? 0 },
  ];

  const recruiterHotlistStages = [
    { label: 'Posted', value: recruiterActivity?.hotlist_received_funnel.posted ?? 0 },
    { label: 'Previewed', value: recruiterActivity?.hotlist_received_funnel.previewed ?? 0 },
    { label: 'Requested', value: recruiterActivity?.hotlist_received_funnel.requested ?? 0 },
    { label: 'Fulfilled', value: recruiterActivity?.hotlist_received_funnel.fulfilled ?? 0 },
  ];
  const recruiterJobsStages = [
    { label: 'Reached Out', value: recruiterActivity?.jobs_applying_funnel.reached_out ?? 0 },
    { label: 'Progressed', value: recruiterActivity?.jobs_applying_funnel.progressed ?? 0 },
    { label: 'Qualified', value: recruiterActivity?.jobs_applying_funnel.qualified ?? 0 },
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
              {/* Vendor column — posts Jobs, requests from Hotlist */}
              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-4 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                    <Briefcase size={15} />
                  </span>
                  <div>
                    <p className="text-[14px] font-bold text-gray-900">Vendor</p>
                    <p className="text-[11px] text-gray-400">Posts Jobs · Requests consultants from Hotlist</p>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-2">
                  <SmallStat icon={MessageSquare} label="Conversations" value={vendorActivity?.conversations ?? 0} />
                  <SmallStat icon={Download} label="Recruiter contacts downloaded" value={vendorActivity?.contacts_downloaded ?? 0} />
                </div>

                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">My Jobs — Received</p>
                <FunnelChart stages={vendorJobsStages} color="#2563eb" />
                {(vendorActivity?.jobs_received_funnel.rejected ?? 0) > 0 && (
                  <p className="mt-2 text-[11px] text-gray-400">{vendorActivity?.jobs_received_funnel.rejected} rejected in this period</p>
                )}

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Hotlist — Requested by me</p>
                <FunnelChart stages={vendorHotlistStages} color="#0d9488" />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Daily Trend</p>
                <DailyBarChart
                  data={vendorActivity?.daily ?? []}
                  series={[
                    { key: 'previews', label: 'Job Previews', color: '#93c5fd' },
                    { key: 'applications', label: 'Applications', color: '#2563eb' },
                    { key: 'requests', label: 'Hotlist Requests', color: '#0d9488' },
                  ]}
                />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Activity Heatmap</p>
                <HeatmapStrip data={vendorActivity?.daily ?? []} valueKeys={['previews', 'applications', 'requests']} color="#2563eb" />
              </section>

              {/* Recruiter (bench sales) column — posts Hotlist, applies to Jobs */}
              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-4 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-purple-50 text-purple-700">
                    <UserRound size={15} />
                  </span>
                  <div>
                    <p className="text-[14px] font-bold text-gray-900">Recruiter (Bench Sales)</p>
                    <p className="text-[11px] text-gray-400">Posts Hotlist · Applies to Jobs with consultants</p>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-2">
                  <SmallStat icon={MessageSquare} label="Conversations" value={recruiterActivity?.conversations ?? 0} />
                  <SmallStat icon={Download} label="Vendor contacts downloaded" value={recruiterActivity?.contacts_downloaded ?? 0} />
                </div>

                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">My Hotlist — Received</p>
                <FunnelChart stages={recruiterHotlistStages} color="#9333ea" />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Jobs — Applied to</p>
                <FunnelChart stages={recruiterJobsStages} color="#db2777" />
                {recruiterActivity && (recruiterActivity.jobs_applying_funnel.via_submission_total > 0 || recruiterActivity.jobs_applying_funnel.via_outreach_total > 0) && (
                  <p className="mt-2 text-[11px] text-gray-400">
                    {recruiterActivity.jobs_applying_funnel.via_submission_total} via consultant submission ({recruiterActivity.jobs_applying_funnel.via_submission_screening_completed} screened),
                    {' '}{recruiterActivity.jobs_applying_funnel.via_outreach_total} via outreach email ({recruiterActivity.jobs_applying_funnel.via_outreach_delivered} delivered)
                  </p>
                )}

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Daily Trend</p>
                <DailyBarChart
                  data={recruiterActivity?.daily ?? []}
                  series={[
                    { key: 'previews', label: 'Hotlist Previews', color: '#d8b4fe' },
                    { key: 'requests', label: 'Requests Received', color: '#9333ea' },
                    { key: 'submitted', label: 'Jobs Applied', color: '#db2777' },
                  ]}
                />

                <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Activity Heatmap</p>
                <HeatmapStrip data={recruiterActivity?.daily ?? []} valueKeys={['previews', 'requests', 'submitted']} color="#9333ea" />
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
