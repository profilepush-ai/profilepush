import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase, CheckCircle2, Clock3, CreditCard, Download, Eye, FileText,
  MessageSquare, Send, UserRound, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import AppNav from '../components/AppNav';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

// Same markup BillingPage.tsx uses to turn api_usage_log's raw cost_usd into
// displayed credits — duplicated here (no shared constant module for it)
// since this is just a summary card, not the full usage breakdown.
const MARKUP = 4;
const ACTIVE_LIST_DAILY_CAP = 50;

type PulseDashboardStats = {
  submissions_today: number;
  job_previews_today: number;
  job_submits_today: number;
  hotlist_previews_today: number;
  hotlist_requests_today: number;
  jobs_posted: number;
  hotlists_posted: number;
};

type ApplicationFunnel = {
  total_applications: number;
  submitted_count: number;
  screening_sent_count: number;
  screening_completed_count: number;
  qualified_count: number;
  rejected_count: number;
};

type PostMetricsTotals = {
  previewCount: number;
  chatCount: number;
  shareCount: number;
  applicationCount: number;
};

function StatCard({ icon: Icon, label, value, tone, loading }: {
  icon: LucideIcon; label: string; value: number; tone: 'blue' | 'orange' | 'violet' | 'emerald' | 'pink' | 'slate'; loading: boolean;
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700',
    orange: 'bg-orange-50 text-orange-700',
    violet: 'bg-violet-50 text-violet-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    pink: 'bg-pink-50 text-pink-700',
    slate: 'bg-slate-100 text-slate-700',
  }[tone];
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${toneClass}`}>
        <Icon size={14} />
      </span>
      <div className="mt-1.5 text-[21px] font-bold text-gray-900">
        {loading ? <span className="inline-block h-5 w-8 animate-pulse rounded bg-gray-200" /> : value}
      </div>
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { account } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dashboardStats, setDashboardStats] = useState<PulseDashboardStats | null>(null);
  const [funnel, setFunnel] = useState<ApplicationFunnel | null>(null);
  const [postTotals, setPostTotals] = useState<PostMetricsTotals | null>(null);
  const [weeklyUsageCredits, setWeeklyUsageCredits] = useState(0);
  const [outreachSent, setOutreachSent] = useState(0);
  const [outreachCompleted, setOutreachCompleted] = useState(0);
  const [conversationCount, setConversationCount] = useState(0);
  const [activeListToday, setActiveListToday] = useState(0);

  useEffect(() => {
    if (!account?.id) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Each call is assigned to its own explicitly-typed const BEFORE being
      // combined in Promise.all below — composing the array directly from
      // inline calls collapsed every element's type to `never`, because a
      // couple of these calls (RPCs/tables absent from the stale generated
      // Supabase types) fail overload resolution and that poisons inference
      // for the whole array literal, not just the failing element.
      const dashboardStatsCall = supabase.rpc('get_pulse_dashboard_stats' as never, { p_account_id: account.id } as never) as unknown as
        Promise<{ data: PulseDashboardStats | null }>;
      const funnelCall = supabase.rpc('get_account_application_funnel' as never) as unknown as
        Promise<{ data: ApplicationFunnel[] | null }>;
      const postMetricsCall = supabase.rpc('get_my_post_metrics' as never) as unknown as
        Promise<{ data: Array<{ preview_count: number; chat_count: number; share_count: number; application_count: number }> | null }>;
      const usageLogCall = supabase.from('api_usage_log').select('cost_usd').eq('account_id', account.id).gte('created_at', sevenDaysAgo) as unknown as
        Promise<{ data: Array<{ cost_usd: number | null }> | null }>;
      const outreachCall = supabase.from('pulse_ask_ai_requests' as never).select('status').eq('account_id', account.id).gte('created_at', thirtyDaysAgo) as unknown as
        Promise<{ data: Array<{ status: string }> | null }>;
      const conversationCall = supabase.from('vendor_conversations').select('id', { count: 'exact', head: true }).eq('account_id', account.id);
      const activeListCall = supabase.from('active_list_downloads' as never).select('count').eq('account_id', account.id).gte('created_at', twentyFourHoursAgo) as unknown as
        Promise<{ data: Array<{ count: number }> | null }>;

      const [
        dashboardStatsResult, funnelResult, postMetricsResult, usageLogResult, outreachResult, conversationResult, activeListResult,
      ] = await Promise.all([
        dashboardStatsCall, funnelCall, postMetricsCall, usageLogCall, outreachCall, conversationCall, activeListCall,
      ]);

      if (cancelled) return;

      if (dashboardStatsResult.data) setDashboardStats(dashboardStatsResult.data);
      if (funnelResult.data) {
        const row = Array.isArray(funnelResult.data) ? funnelResult.data[0] : funnelResult.data;
        if (row) setFunnel(row);
      }
      if (postMetricsResult.data) {
        setPostTotals(postMetricsResult.data.reduce((acc, row) => ({
          previewCount: acc.previewCount + (row.preview_count || 0),
          chatCount: acc.chatCount + (row.chat_count || 0),
          shareCount: acc.shareCount + (row.share_count || 0),
          applicationCount: acc.applicationCount + (row.application_count || 0),
        }), { previewCount: 0, chatCount: 0, shareCount: 0, applicationCount: 0 }));
      }
      if (usageLogResult.data) {
        const totalCost = usageLogResult.data.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);
        setWeeklyUsageCredits(Math.round(totalCost * MARKUP * 100) / 100);
      }
      if (outreachResult.data) {
        setOutreachSent(outreachResult.data.length);
        setOutreachCompleted(outreachResult.data.filter((r) => r.status === 'completed').length);
      }
      if (typeof conversationResult.count === 'number') setConversationCount(conversationResult.count);
      if (activeListResult.data) {
        setActiveListToday(activeListResult.data.reduce((sum, row) => sum + (row.count || 0), 0));
      }

      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [account?.id]);

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-[#f3f2ee] text-gray-900 flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4">
          <div className="mb-4">
            <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>
            <p className="text-[12px] text-gray-500">Your account&apos;s activity at a glance.</p>
          </div>

          {/* Credits */}
          <section className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                  <CreditCard size={16} />
                </span>
                <div>
                  <p className="text-[20px] font-bold text-gray-900">{account?.credits_balance ?? 0} credits</p>
                  <p className="text-[11px] text-gray-500">
                    {loading ? 'Loading usage…' : `${weeklyUsageCredits} credits used in the last 7 days`}
                  </p>
                </div>
              </div>
              <Link to="/billing" className="shrink-0 text-[12px] font-semibold text-blue-600 hover:underline">
                View Billing →
              </Link>
            </div>
          </section>

          {/* Today's activity */}
          <section className="mb-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Today</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard icon={Eye} label="Job Previews" value={dashboardStats?.job_previews_today ?? 0} tone="emerald" loading={loading} />
              <StatCard icon={Send} label="Job Submits" value={dashboardStats?.job_submits_today ?? 0} tone="blue" loading={loading} />
              <StatCard icon={Eye} label="Hotlist Previews" value={dashboardStats?.hotlist_previews_today ?? 0} tone="violet" loading={loading} />
              <StatCard icon={FileText} label="Hotlist Requests" value={dashboardStats?.hotlist_requests_today ?? 0} tone="pink" loading={loading} />
              <StatCard icon={Briefcase} label="Jobs Posted" value={dashboardStats?.jobs_posted ?? 0} tone="orange" loading={loading} />
              <StatCard icon={UserRound} label="Hotlists Posted" value={dashboardStats?.hotlists_posted ?? 0} tone="slate" loading={loading} />
            </div>
          </section>

          {/* Posts & Applications */}
          <section className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-bold text-gray-900">Posts &amp; Applications</p>
              <Link to="/posts" className="text-[12px] font-semibold text-blue-600 hover:underline">View Posts →</Link>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md bg-gray-50 p-2.5 text-center">
                <p className="text-[17px] font-bold text-gray-900">{loading ? '—' : postTotals?.previewCount ?? 0}</p>
                <p className="text-[10px] font-medium text-gray-500">Previews</p>
              </div>
              <div className="rounded-md bg-gray-50 p-2.5 text-center">
                <p className="text-[17px] font-bold text-gray-900">{loading ? '—' : postTotals?.chatCount ?? 0}</p>
                <p className="text-[10px] font-medium text-gray-500">Chats</p>
              </div>
              <div className="rounded-md bg-gray-50 p-2.5 text-center">
                <p className="text-[17px] font-bold text-gray-900">{loading ? '—' : postTotals?.shareCount ?? 0}</p>
                <p className="text-[10px] font-medium text-gray-500">Shares</p>
              </div>
              <div className="rounded-md bg-gray-50 p-2.5 text-center">
                <p className="text-[17px] font-bold text-gray-900">{loading ? '—' : postTotals?.applicationCount ?? 0}</p>
                <p className="text-[10px] font-medium text-gray-500">Applications</p>
              </div>
            </div>

            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Application Funnel</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {([
                { label: 'Submitted', value: funnel?.submitted_count ?? 0, icon: Clock3, tone: 'text-gray-500' },
                { label: 'Screening Sent', value: funnel?.screening_sent_count ?? 0, icon: Send, tone: 'text-blue-600' },
                { label: 'Screening Done', value: funnel?.screening_completed_count ?? 0, icon: CheckCircle2, tone: 'text-violet-600' },
                { label: 'Qualified', value: funnel?.qualified_count ?? 0, icon: CheckCircle2, tone: 'text-emerald-600' },
                { label: 'Rejected', value: funnel?.rejected_count ?? 0, icon: XCircle, tone: 'text-red-500' },
              ]).map((stage) => (
                <div key={stage.label} className="rounded-md border border-gray-100 p-2.5 text-center">
                  <stage.icon size={14} className={`mx-auto mb-1 ${stage.tone}`} />
                  <p className="text-[15px] font-bold text-gray-900">{loading ? '—' : stage.value}</p>
                  <p className="text-[10px] font-medium text-gray-500">{stage.label}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Outreach & Active List */}
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[13px] font-bold text-gray-900">Outreach</p>
                <Link to="/inbox" className="text-[12px] font-semibold text-blue-600 hover:underline">View Inbox →</Link>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md bg-gray-50 p-2.5 text-center">
                  <Send size={14} className="mx-auto mb-1 text-gray-400" />
                  <p className="text-[16px] font-bold text-gray-900">{loading ? '—' : outreachSent}</p>
                  <p className="text-[10px] font-medium text-gray-500">Sent (30d)</p>
                </div>
                <div className="rounded-md bg-gray-50 p-2.5 text-center">
                  <CheckCircle2 size={14} className="mx-auto mb-1 text-emerald-500" />
                  <p className="text-[16px] font-bold text-gray-900">{loading ? '—' : outreachCompleted}</p>
                  <p className="text-[10px] font-medium text-gray-500">Completed</p>
                </div>
                <div className="rounded-md bg-gray-50 p-2.5 text-center">
                  <MessageSquare size={14} className="mx-auto mb-1 text-gray-400" />
                  <p className="text-[16px] font-bold text-gray-900">{loading ? '—' : conversationCount}</p>
                  <p className="text-[10px] font-medium text-gray-500">Conversations</p>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[13px] font-bold text-gray-900">Active List</p>
                <Link to="/active-list" className="text-[12px] font-semibold text-blue-600 hover:underline">View Active List →</Link>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-sky-50 text-sky-700">
                  <Download size={16} />
                </span>
                <div>
                  <p className="text-[18px] font-bold text-gray-900">
                    {loading ? '—' : activeListToday} / {ACTIVE_LIST_DAILY_CAP}
                  </p>
                  <p className="text-[11px] text-gray-500">Contacts downloaded in the last 24 hours</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
