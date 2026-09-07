import { useEffect, useState } from 'react';
import { Briefcase, Check, ChevronDown, Clock3, Download, Info, MessageSquare, Send, Sparkles, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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

const PERSONA_ACCENT = {
  vendor: { icon: Briefcase, iconBg: 'bg-blue-50', iconColor: 'text-blue-700', label: 'Vendor' },
  recruiter: { icon: UserRound, iconBg: 'bg-purple-50', iconColor: 'text-purple-700', label: 'Recruiter' },
} as const;

const AI_SUGGESTIONS = [
  'How is my activity trending this period?',
  'What should I focus on next?',
  'Compare my vendor and recruiter activity',
];

// One header per persona column (instead of repeating "Vendor"/"Recruiter"
// on every widget inside it) — the column itself is already the grouping.
function ColumnHeader({ persona }: { persona: keyof typeof PERSONA_ACCENT }) {
  const accent = PERSONA_ACCENT[persona];
  return (
    <div className="mb-1 flex items-center gap-2 px-1">
      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${accent.iconBg} ${accent.iconColor}`}>
        <accent.icon size={12} />
      </span>
      <h2 className="text-[13px] font-bold uppercase tracking-wide text-gray-500">{accent.label}</h2>
    </div>
  );
}

// Every chart/funnel/stat is its own independent card sitting directly on
// the page background — not nested inside one big per-persona container.
// The tooltip's info icon sits on the title itself, never on a subtitle.
function Widget({ persona, title, subtitle, tooltip, children }: {
  persona: keyof typeof PERSONA_ACCENT;
  title: string;
  subtitle?: string;
  tooltip: string;
  children: React.ReactNode;
}) {
  const accent = PERSONA_ACCENT[persona];
  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${accent.iconBg} ${accent.iconColor}`}>
          <accent.icon size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="truncate text-[13px] font-bold text-gray-900">{title}</p>
            <span title={tooltip} className="shrink-0 cursor-help text-gray-300">
              <Info size={11} />
            </span>
          </div>
          {subtitle && <p className="truncate text-[11px] text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function StatWidget({ persona, icon: Icon, label, value, tooltip }: {
  persona: keyof typeof PERSONA_ACCENT; icon: LucideIcon; label: string; value: number; tooltip: string;
}) {
  const accent = PERSONA_ACCENT[persona];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${accent.iconBg} ${accent.iconColor}`}>
          <Icon size={13} />
        </span>
        <div className="flex min-w-0 items-start gap-1">
          <p className="text-[12px] font-bold leading-tight text-gray-900">{label}</p>
          <span title={tooltip} className="mt-0.5 shrink-0 cursor-help text-gray-300">
            <Info size={10} />
          </span>
        </div>
      </div>
      <p className="text-[20px] font-bold text-gray-900">{value}</p>
    </div>
  );
}

function AiInsightsWidget({ days, rangeLabel }: { days: number; rangeLabel: string }) {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [conversation, setConversation] = useState<Array<{ question: string; answer: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  async function ask(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dashboard-ai-insights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ question: trimmed, days }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to get an answer');
      setConversation((prev) => [...prev, { question: trimmed, answer: data.answer || 'No answer returned.' }]);
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach the AI service.');
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
          <Sparkles size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-bold uppercase tracking-wide text-gray-400">AI Insights</p>
          <div className="flex items-center gap-1">
            <p className="truncate text-[13px] font-bold text-gray-900">Ask about your data ({rangeLabel.toLowerCase()})</p>
            <span
              title="Ask a question in plain English and the AI answers using only your own Vendor and Recruiter activity data for the selected date range."
              className="shrink-0 cursor-help text-gray-300"
            >
              <Info size={11} />
            </span>
          </div>
        </div>
      </div>

      {conversation.length > 0 && (
        <div className="mb-3 max-h-72 space-y-3 overflow-y-auto pr-1">
          {conversation.map((turn, i) => (
            <div key={i} className="space-y-1">
              <p className="text-[12px] font-semibold text-gray-800">{turn.question}</p>
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-600">{turn.answer}</p>
            </div>
          ))}
        </div>
      )}

      {conversation.length === 0 && !asking && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {AI_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 transition hover:bg-gray-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mb-2 text-[11px] text-red-500">{error}</p>}

      <form
        onSubmit={(e) => { e.preventDefault(); void ask(question); }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your activity…"
          disabled={asking}
          className="flex-1 rounded-full border border-gray-200 px-3.5 py-2 text-[12px] outline-none focus:border-gray-400 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={asking || !question.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-900 px-3.5 py-2 text-[12px] font-semibold text-white transition disabled:opacity-40"
        >
          {asking ? <LogoSpinner size={12} /> : <Send size={13} />}
          Ask
        </button>
      </form>
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
            <>
              {/* Full-width AI Insights section, separate from the persona columns below. */}
              <AiInsightsWidget days={range.days} rangeLabel={range.label} />

              {/* Vendor and Recruiter each get their own dedicated column — no
                  interleaving — laid out top-to-bottom as: heatmap, stats,
                  funnels, daily trend. A single grid, no per-column scroll. */}
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                <div className="flex flex-col">
                  <ColumnHeader persona="vendor" />

                  <Widget persona="vendor" title="Activity Heatmap" tooltip="At-a-glance intensity of your Vendor-side activity (job previews, applications received, hotlist requests sent) each day in the selected range.">
                    <HeatmapStrip data={vendorActivity?.daily ?? []} valueKeys={['previews', 'applications', 'requests']} color="#2563eb" />
                  </Widget>

                  <div className="mb-4 grid grid-cols-2 gap-4">
                    <StatWidget
                      persona="vendor"
                      icon={MessageSquare}
                      label="Conversations"
                      value={vendorActivity?.conversations ?? 0}
                      tooltip="Chat threads you're part of as a Vendor — either threads on jobs you posted, or threads you started requesting a Hotlist resume."
                    />
                    <StatWidget
                      persona="vendor"
                      icon={Download}
                      label="Recruiter Contacts"
                      value={vendorActivity?.contacts_downloaded ?? 0}
                      tooltip="Recruiter contact details you've unlocked via Active List, to source consultants for your job requirements."
                    />
                  </div>

                  <Widget persona="vendor" title="My Jobs — Received" tooltip="How recruiters are engaging with the jobs you've posted: previews, applications received, screenings completed, and qualified candidates.">
                    <FunnelChart stages={vendorJobsStages} color="#2563eb" />
                    {(vendorActivity?.jobs_received_funnel.rejected ?? 0) > 0 && (
                      <p className="mt-2 text-[11px] text-gray-400">{vendorActivity?.jobs_received_funnel.rejected} rejected in this period</p>
                    )}
                  </Widget>

                  <Widget persona="vendor" title="Hotlist — Requested by me" tooltip="Resume requests you've sent on other recruiters' Hotlist posts, and how many were fulfilled.">
                    <FunnelChart stages={vendorHotlistStages} color="#0d9488" />
                  </Widget>

                  <Widget persona="vendor" title="Daily Trend" tooltip="Daily counts of job previews, applications received, and hotlist requests you sent, as a Vendor.">
                    <DailyBarChart
                      data={vendorActivity?.daily ?? []}
                      series={[
                        { key: 'previews', label: 'Job Previews', color: '#93c5fd' },
                        { key: 'applications', label: 'Applications', color: '#2563eb' },
                        { key: 'requests', label: 'Hotlist Requests', color: '#0d9488' },
                      ]}
                    />
                  </Widget>
                </div>

                <div className="flex flex-col">
                  <ColumnHeader persona="recruiter" />

                  <Widget persona="recruiter" title="Activity Heatmap" tooltip="At-a-glance intensity of your Recruiter-side activity (hotlist previews, requests received, jobs applied to) each day in the selected range.">
                    <HeatmapStrip data={recruiterActivity?.daily ?? []} valueKeys={['previews', 'requests', 'submitted']} color="#9333ea" />
                  </Widget>

                  <div className="mb-4 grid grid-cols-2 gap-4">
                    <StatWidget
                      persona="recruiter"
                      icon={MessageSquare}
                      label="Conversations"
                      value={recruiterActivity?.conversations ?? 0}
                      tooltip="Chat threads you're part of as a Recruiter — either threads on your Hotlist listings, or threads you started applying to a job."
                    />
                    <StatWidget
                      persona="recruiter"
                      icon={Download}
                      label="Vendor Contacts"
                      value={recruiterActivity?.contacts_downloaded ?? 0}
                      tooltip="Vendor contact details you've unlocked via Active List, to find companies to pitch your consultants to."
                    />
                  </div>

                  <Widget persona="recruiter" title="My Hotlist — Received" tooltip="How vendors are engaging with the Hotlist listings you've posted: previews, resume requests, and fulfillments.">
                    <FunnelChart stages={recruiterHotlistStages} color="#9333ea" />
                  </Widget>

                  <Widget persona="recruiter" title="Jobs — Applied to" tooltip="Your outreach on jobs — via direct consultant submission or AI outreach email — and how far it progressed.">
                    <FunnelChart stages={recruiterJobsStages} color="#db2777" />
                    {recruiterActivity && (recruiterActivity.jobs_applying_funnel.via_submission_total > 0 || recruiterActivity.jobs_applying_funnel.via_outreach_total > 0) && (
                      <p className="mt-2 text-[11px] text-gray-400">
                        {recruiterActivity.jobs_applying_funnel.via_submission_total} via consultant submission ({recruiterActivity.jobs_applying_funnel.via_submission_screening_completed} screened),
                        {' '}{recruiterActivity.jobs_applying_funnel.via_outreach_total} via outreach email ({recruiterActivity.jobs_applying_funnel.via_outreach_delivered} delivered)
                      </p>
                    )}
                  </Widget>

                  <Widget persona="recruiter" title="Daily Trend" tooltip="Daily counts of hotlist previews, requests received, and jobs you applied to, as a Recruiter.">
                    <DailyBarChart
                      data={recruiterActivity?.daily ?? []}
                      series={[
                        { key: 'previews', label: 'Hotlist Previews', color: '#d8b4fe' },
                        { key: 'requests', label: 'Requests Received', color: '#9333ea' },
                        { key: 'submitted', label: 'Jobs Applied', color: '#db2777' },
                      ]}
                    />
                  </Widget>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
