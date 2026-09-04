import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, Check, CheckCircle2, ChevronDown, ChevronUp, Clock3, ExternalLink, LayoutGrid,
  MessageSquare, Search, Sparkles, UserRound, Video, X, XCircle,
  type LucideIcon,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';

type KindFilter = 'all' | 'job' | 'hotlist';
type StatusFilter = 'open' | 'closed';

const KIND_FILTER_OPTIONS: Array<{ id: KindFilter; label: string; icon: LucideIcon }> = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'job', label: 'Jobs', icon: Briefcase },
  { id: 'hotlist', label: 'Hotlist', icon: UserRound },
];

const STATUS_FILTER_OPTIONS: Array<{ id: StatusFilter; label: string; icon: LucideIcon }> = [
  { id: 'open', label: 'Open', icon: Check },
  { id: 'closed', label: 'Closed', icon: XCircle },
];

const CLOSED_APPLICATION_STATUSES = new Set(['shortlisted', 'rejected']);
const CLOSED_ASK_AI_STATUSES = new Set(['failed', 'refunded']);

const APPLICATION_STATUS_STYLES: Record<string, string> = {
  submitted: 'border-gray-200 bg-gray-100 text-gray-600',
  screening_sent: 'border-blue-200 bg-blue-50 text-blue-700',
  screening_completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  shortlisted: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  rejected: 'border-red-200 bg-red-50 text-red-600',
};
const APPLICATION_STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  screening_sent: 'Screening sent',
  screening_completed: 'Screening complete',
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
};

const ASK_AI_STATUS_STYLES: Record<string, string> = {
  processing: 'border-blue-200 bg-blue-50 text-blue-700',
  charged: 'border-blue-200 bg-blue-50 text-blue-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-red-200 bg-red-50 text-red-600',
  refunded: 'border-gray-200 bg-gray-100 text-gray-500',
};
const ASK_AI_STATUS_LABELS: Record<string, string> = {
  processing: 'Requesting…',
  charged: 'Requesting…',
  completed: 'Requested',
  failed: 'Failed',
  refunded: 'Refunded',
};

interface ApplicationRow {
  kind: 'job';
  id: string;
  socialJobId: string;
  jobTitle: string;
  companyName: string;
  candidateName: string;
  status: string;
  aiScore: number | null;
  screeningToken: string;
  createdAt: string;
}

interface TurnRow {
  id: string;
  application_id: string;
  turn_index: number;
  question_text: string;
  video_stream_uid: string | null;
  answered_at: string | null;
}

interface HotlistAskRow {
  kind: 'hotlist';
  type: 'ask_ai';
  id: string;
  hotlistId: string;
  roleTitle: string;
  candidateName: string;
  companyName: string;
  status: string;
  createdAt: string;
}

interface HotlistChatRow {
  kind: 'hotlist';
  type: 'chat';
  id: string;
  hotlistId: string;
  subject: string;
  ownerDisplayName: string;
  status: string;
  hasUnread: boolean;
  createdAt: string;
}

type HotlistRow = HotlistAskRow | HotlistChatRow;
type TrackerRow = ApplicationRow | HotlistRow;

function formatAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isRowClosed(row: TrackerRow): boolean {
  if (row.kind === 'job') return CLOSED_APPLICATION_STATUSES.has(row.status);
  if (row.type === 'ask_ai') return CLOSED_ASK_AI_STATUSES.has(row.status);
  return row.status === 'closed';
}

function matchesSearch(row: TrackerRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (row.kind === 'job') {
    return [row.jobTitle, row.companyName, row.candidateName].join(' ').toLowerCase().includes(q);
  }
  if (row.type === 'ask_ai') {
    return [row.roleTitle, row.candidateName, row.companyName].join(' ').toLowerCase().includes(q);
  }
  return [row.subject, row.ownerDisplayName].join(' ').toLowerCase().includes(q);
}

export default function TrackerPage() {
  const { account } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [pendingSearchQuery, setPendingSearchQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [turnsByApplication, setTurnsByApplication] = useState<Record<string, TurnRow[]>>({});
  const [hotlistRows, setHotlistRows] = useState<HotlistRow[]>([]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [videoModal, setVideoModal] = useState<{ url: string } | null>(null);
  const [loadingVideoTurnId, setLoadingVideoTurnId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => setToast({ message, type }), []);

  const loadData = useCallback(async () => {
    if (!account?.id) return;
    setLoading(true);

    const [appsResult, askResult, chatResult] = await Promise.all([
      supabase
        .from('job_applications')
        .select('id, social_job_id, candidate_name, status, ai_score, screening_token, created_at, social_jobs(job_title, company_name)')
        .eq('created_by_account_id', account.id)
        .order('created_at', { ascending: false }),
      supabase.rpc('get_my_hotlist_ask_requests' as never),
      supabase
        .from('post_chat_threads')
        .select('id, hotlist_id, subject, owner_display_name, status, participant_unread_count, created_at')
        .eq('participant_account_id', account.id)
        .eq('post_kind', 'hotlist')
        .order('created_at', { ascending: false }),
    ]);

    if (!appsResult.error) {
      const rows = (appsResult.data ?? []) as unknown as Array<{
        id: string; social_job_id: string; candidate_name: string; status: string;
        ai_score: number | null; screening_token: string; created_at: string;
        social_jobs: { job_title: string; company_name: string } | null;
      }>;
      setApplications(rows.map((r): ApplicationRow => ({
        kind: 'job',
        id: r.id,
        socialJobId: r.social_job_id,
        jobTitle: r.social_jobs?.job_title || 'Job Opportunity',
        companyName: r.social_jobs?.company_name || '',
        candidateName: r.candidate_name,
        status: r.status,
        aiScore: r.ai_score,
        screeningToken: r.screening_token,
        createdAt: r.created_at,
      })));

      const appIds = rows.map((r) => r.id);
      if (appIds.length > 0) {
        const { data: turns } = await supabase
          .from('job_application_screening_turns')
          .select('id, application_id, turn_index, question_text, video_stream_uid, answered_at')
          .in('application_id', appIds)
          .order('turn_index', { ascending: true });
        const grouped: Record<string, TurnRow[]> = {};
        for (const turn of (turns ?? []) as unknown as TurnRow[]) {
          (grouped[turn.application_id] ??= []).push(turn);
        }
        setTurnsByApplication(grouped);
      }
    }

    const askRows = (!askResult.error ? (askResult.data ?? []) : []) as unknown as Array<{
      id: string; hotlist_id: string; role_title: string; candidate_name: string;
      company_name: string; status: string; created_at: string;
    }>;
    const chatRows = (!chatResult.error ? (chatResult.data ?? []) : []) as unknown as Array<{
      id: string; hotlist_id: string; subject: string; owner_display_name: string;
      status: string; participant_unread_count: number; created_at: string;
    }>;

    const combinedHotlist: HotlistRow[] = [
      ...askRows.map((r): HotlistAskRow => ({
        kind: 'hotlist', type: 'ask_ai',
        id: r.id, hotlistId: r.hotlist_id, roleTitle: r.role_title,
        candidateName: r.candidate_name, companyName: r.company_name,
        status: r.status, createdAt: r.created_at,
      })),
      ...chatRows.map((r): HotlistChatRow => ({
        kind: 'hotlist', type: 'chat',
        id: r.id, hotlistId: r.hotlist_id, subject: r.subject || 'Available Consultant',
        ownerDisplayName: r.owner_display_name, status: r.status,
        hasUnread: r.participant_unread_count > 0, createdAt: r.created_at,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setHotlistRows(combinedHotlist);

    setLoading(false);
  }, [account?.id]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function handleWatch(turnId: string) {
    setLoadingVideoTurnId(turnId);
    const { data, error } = await supabase.functions.invoke('get-application-video-embed', {
      body: { turnId },
    });
    setLoadingVideoTurnId(null);
    if (error || !data?.iframeUrl) {
      showToast((data as { error?: string } | null)?.error || 'Could not load this video', 'error');
      return;
    }
    setVideoModal({ url: data.iframeUrl as string });
  }

  const allRows: TrackerRow[] = useMemo(() => [...applications, ...hotlistRows], [applications, hotlistRows]);

  const rows = useMemo(() => {
    const source = kindFilter === 'all' ? allRows : kindFilter === 'job' ? applications : hotlistRows;
    return source
      .filter((row) => (statusFilter === 'closed' ? isRowClosed(row) : !isRowClosed(row)))
      .filter((row) => matchesSearch(row, searchQuery))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [kindFilter, allRows, applications, hotlistRows, statusFilter, searchQuery]);

  const kindCounts: Record<KindFilter, number> = {
    all: allRows.filter((r) => (statusFilter === 'closed' ? isRowClosed(r) : !isRowClosed(r))).length,
    job: applications.filter((r) => (statusFilter === 'closed' ? isRowClosed(r) : !isRowClosed(r))).length,
    hotlist: hotlistRows.filter((r) => (statusFilter === 'closed' ? isRowClosed(r) : !isRowClosed(r))).length,
  };
  const statusCounts: Record<StatusFilter, number> = {
    open: allRows.filter((r) => !isRowClosed(r)).length,
    closed: allRows.filter((r) => isRowClosed(r)).length,
  };

  function kindFilterButtonsEl() {
    return KIND_FILTER_OPTIONS.map((option) => {
      const isSelected = kindFilter === option.id;
      const Icon = option.icon;
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => setKindFilter(option.id)}
          className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${isSelected ? (isDark ? 'border border-white/25 bg-[#2A2E35] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-white/5' : 'border border-transparent bg-white text-gray-500 hover:text-gray-700')}`}
        >
          <Icon size={11} />
          <span>{option.label}</span>
          <span>{kindCounts[option.id]}</span>
        </button>
      );
    });
  }

  function statusFilterButtonsEl() {
    return STATUS_FILTER_OPTIONS.map((option) => {
      const isSelected = statusFilter === option.id;
      const Icon = option.icon;
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => setStatusFilter(option.id)}
          className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${isSelected ? (isDark ? 'border border-white/25 bg-[#2A2E35] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-white/5' : 'border border-transparent bg-white text-gray-500 hover:text-gray-700')}`}
        >
          <Icon size={11} />
          <span>{option.label}</span>
          <span>{statusCounts[option.id]}</span>
        </button>
      );
    });
  }

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-[#f3f2ee] text-gray-900 flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0 dark:bg-[#1B1D21] dark:text-slate-100">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full w-full flex flex-col overflow-hidden px-2 py-2">
          <div className="flex shrink-0 items-center gap-2 pb-2">
            <div className="flex shrink-0 items-center gap-1">
              {kindFilterButtonsEl()}
            </div>
            <div className="relative flex min-w-[160px] flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/10 dark:bg-[#20242a]">
              <Search size={11} className="text-gray-400" />
              <input
                type="text"
                value={pendingSearchQuery}
                onChange={(e) => setPendingSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); setSearchQuery(pendingSearchQuery.trim()); }
                }}
                placeholder="Search applications and requests"
                className="w-full border-0 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:text-slate-200 dark:placeholder:text-[#64748B]"
              />
              {pendingSearchQuery && (
                <button type="button" onClick={() => { setPendingSearchQuery(''); setSearchQuery(''); }} className="rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-white/10" aria-label="Clear search">
                  <X size={11} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSearchQuery(pendingSearchQuery.trim())}
              className="shrink-0 rounded-full border border-blue-600 bg-blue-600 p-1.5 text-white transition hover:bg-blue-700"
              aria-label="Search"
            >
              <Search size={12} />
            </button>
            <div className="flex shrink-0 items-center gap-1">
              {statusFilterButtonsEl()}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[#dfdad2] bg-white dark:border-white/10 dark:bg-[#1E2126]">
            {loading ? (
              <div className="flex items-center justify-center py-16"><LogoSpinner size={22} /></div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-[13px] font-semibold text-gray-500 dark:text-slate-400">
                  {searchQuery ? 'No results match your search' : statusFilter === 'closed' ? 'Nothing closed yet' : 'No open activity yet'}
                </p>
                <p className="mt-1 text-[12px] text-gray-400 dark:text-[#64748B]">
                  {searchQuery ? 'Try a different search term.' : 'Applications you submit and Hotlist requests you send will show up here.'}
                </p>
              </div>
            ) : (
              <table className="w-full min-w-[900px] border-collapse text-left text-[12px]">
                <thead>
                  <tr className={`sticky top-0 z-10 border-b ${isDark ? 'border-white/10 bg-[#20242a]' : 'border-gray-200 bg-gray-50'}`}>
                    {kindFilter === 'all' && <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Kind</th>}
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Details</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Date</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Status</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Match Score</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Screening</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    if (row.kind === 'job') {
                      const turns = turnsByApplication[row.id] ?? [];
                      const isExpanded = expandedId === row.id;
                      const screeningUrl = `${window.location.origin}/screen/${row.screeningToken}`;
                      return (
                        <Fragment key={row.id}>
                          <tr className={`border-b ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50'}`}>
                            {kindFilter === 'all' && (
                              <td className="px-3 py-2.5 align-top">
                                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
                                  <Briefcase size={9} />
                                  Job
                                </span>
                              </td>
                            )}
                            <td className="max-w-xs px-3 py-2.5 align-top">
                              <p className="truncate font-semibold text-gray-900 dark:text-slate-100">{row.jobTitle}</p>
                              <p className="truncate text-[11px] text-gray-400 dark:text-[#94A3B8]">
                                {row.companyName}{row.candidateName ? ` · ${row.candidateName}` : ''}
                              </p>
                            </td>
                            <td className="px-3 py-2.5 align-top text-gray-500 dark:text-[#94A3B8]">{formatAgo(row.createdAt)}</td>
                            <td className="px-3 py-2.5 align-top">
                              <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${APPLICATION_STATUS_STYLES[row.status] ?? APPLICATION_STATUS_STYLES.submitted}`}>
                                {APPLICATION_STATUS_LABELS[row.status] ?? row.status}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              {row.aiScore !== null ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-400/30 dark:bg-purple-500/10 dark:text-purple-300">
                                  <Sparkles size={9} strokeWidth={2.5} />
                                  {row.aiScore}/100
                                </span>
                              ) : <span className="text-[11px] text-gray-400 dark:text-[#64748B]">—</span>}
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              <a
                                href={screeningUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-100 dark:border-white/15 dark:bg-white/5 dark:text-slate-300"
                              >
                                <ExternalLink size={9} strokeWidth={2.5} />
                                Screening link
                              </a>
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              {turns.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedId(isExpanded ? null : row.id)}
                                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                >
                                  {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                  {turns.filter((t) => t.answered_at).length}/{turns.length}
                                </button>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className={isDark ? 'bg-white/[0.02]' : 'bg-gray-50/60'}>
                              <td colSpan={kindFilter === 'all' ? 7 : 6} className="px-3 py-3">
                                <div className="flex flex-col gap-2">
                                  {turns.map((turn) => (
                                    <div key={turn.id} className="rounded-md border border-gray-100 bg-white p-2.5 dark:border-white/10 dark:bg-transparent">
                                      <p className="text-[11px] font-semibold text-gray-500 dark:text-slate-400">Q{turn.turn_index + 1}. {turn.question_text}</p>
                                      {turn.answered_at && turn.video_stream_uid ? (
                                        <button
                                          type="button"
                                          onClick={() => void handleWatch(turn.id)}
                                          disabled={loadingVideoTurnId === turn.id}
                                          className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-60 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-400"
                                        >
                                          {loadingVideoTurnId === turn.id ? <LogoSpinner size={11} /> : <Video size={12} />}
                                          Watch answer
                                        </button>
                                      ) : (
                                        <p className="mt-1 text-[11px] text-gray-400 dark:text-[#64748B]">Not answered yet</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    }

                    const isChat = row.type === 'chat';
                    return (
                      <tr key={row.id} className={`border-b ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50'}`}>
                        {kindFilter === 'all' && (
                          <td className="px-3 py-2.5 align-top">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-purple-400/30 bg-purple-500/10 text-purple-300' : 'border-purple-200 bg-purple-50 text-purple-700'}`}>
                              <UserRound size={9} />
                              Hotlist
                            </span>
                          </td>
                        )}
                        <td className="max-w-xs px-3 py-2.5 align-top">
                          <p className="truncate font-semibold text-gray-900 dark:text-slate-100">
                            {isChat ? row.subject : (row.roleTitle || 'Available Consultant')}
                          </p>
                          <p className="truncate text-[11px] text-gray-400 dark:text-[#94A3B8]">
                            {isChat ? row.ownerDisplayName : [row.candidateName, row.companyName].filter(Boolean).join(' · ')}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 align-top text-gray-500 dark:text-[#94A3B8]">{formatAgo(row.createdAt)}</td>
                        <td className="px-3 py-2.5 align-top">
                          {isChat ? (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${row.hasUnread ? (isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700') : row.status === 'closed' ? (isDark ? 'border-white/15 bg-white/5 text-[#94A3B8]' : 'border-gray-200 bg-gray-100 text-gray-500') : (isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600')}`}>
                              {row.hasUnread ? <MessageSquare size={9} strokeWidth={2.5} /> : row.status === 'closed' ? <XCircle size={9} strokeWidth={2.5} /> : <Clock3 size={9} strokeWidth={2.5} />}
                              {row.hasUnread ? 'New reply' : row.status === 'closed' ? 'Closed' : 'Awaiting reply'}
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${ASK_AI_STATUS_STYLES[row.status] ?? ASK_AI_STATUS_STYLES.completed}`}>
                              {row.status === 'completed' ? <CheckCircle2 size={9} strokeWidth={2.5} /> : <Clock3 size={9} strokeWidth={2.5} />}
                              {ASK_AI_STATUS_LABELS[row.status] ?? row.status}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-top text-gray-400 dark:text-[#64748B]">—</td>
                        <td className="px-3 py-2.5 align-top text-gray-400 dark:text-[#64748B]">—</td>
                        <td className="px-3 py-2.5 align-top">
                          {isChat && (
                            <button
                              type="button"
                              onClick={() => navigate(`/inbox/${row.id}`)}
                              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300"
                            >
                              <MessageSquare size={9} strokeWidth={2.5} />
                              Open chat
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {videoModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setVideoModal(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-lg bg-black shadow-2xl">
            <div className="flex items-center justify-end p-1.5">
              <button type="button" onClick={() => setVideoModal(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/80 hover:bg-white/10" aria-label="Close video">
                <X size={16} />
              </button>
            </div>
            <div className="aspect-video w-full">
              <iframe src={videoModal.url} className="h-full w-full" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowFullScreen />
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
