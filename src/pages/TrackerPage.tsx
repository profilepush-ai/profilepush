import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, Check, CheckCircle2, Clock3, ExternalLink, LayoutGrid,
  MessageSquare, Search, Sparkles, UserRound, Video, X, XCircle,
  type LucideIcon,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import ScreeningSubmissionModal from '../components/ScreeningSubmissionModal';
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

const CLOSED_APPLICATION_STATUSES = new Set(['qualified', 'rejected']);
const CLOSED_ASK_AI_STATUSES = new Set(['failed', 'refunded']);

const APPLICATION_STATUS_STYLES: Record<string, string> = {
  submitted: 'border-gray-200 bg-gray-100 text-gray-600',
  screening_sent: 'border-blue-200 bg-blue-50 text-blue-700',
  screening_completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  qualified: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  rejected: 'border-red-200 bg-red-50 text-red-600',
};
const APPLICATION_STATUS_LABELS: Record<string, string> = {
  submitted: 'Applied',
  screening_sent: 'Screening Sent',
  screening_completed: 'Screening Submitted',
  qualified: 'Qualified',
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
  video_r2_key: string | null;
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

  const [watchSubmissionAppId, setWatchSubmissionAppId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

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
          .select('id, application_id, turn_index, question_text, video_r2_key, answered_at')
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

  function kindFilterButtonsEl(compact = false) {
    return KIND_FILTER_OPTIONS.map((option) => {
      const isSelected = kindFilter === option.id;
      const Icon = option.icon;
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => setKindFilter(option.id)}
          title={option.label}
          aria-label={option.label}
          className={`inline-flex items-center justify-center gap-1 rounded-full font-semibold transition ${compact ? 'px-2 py-1.5' : 'px-3 py-1.5 text-[11px]'} ${isSelected ? (isDark ? 'border border-white/25 bg-[#2A2E35] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-white/5' : 'border border-transparent bg-white text-gray-500 hover:text-gray-700')}`}
        >
          <Icon size={compact ? 13 : 11} />
          {!compact && (
            <>
              <span>{option.label}</span>
              <span>{kindCounts[option.id]}</span>
            </>
          )}
        </button>
      );
    });
  }

  function statusFilterButtonsEl(compact = false) {
    return STATUS_FILTER_OPTIONS.map((option) => {
      const isSelected = statusFilter === option.id;
      const Icon = option.icon;
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => setStatusFilter(option.id)}
          title={option.label}
          aria-label={option.label}
          className={`inline-flex items-center justify-center gap-1 rounded-full font-semibold transition ${compact ? 'px-2 py-1.5' : 'px-3 py-1.5 text-[11px]'} ${isSelected ? (isDark ? 'border border-white/25 bg-[#2A2E35] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-white/5' : 'border border-transparent bg-white text-gray-500 hover:text-gray-700')}`}
        >
          <Icon size={compact ? 13 : 11} />
          {!compact && (
            <>
              <span>{option.label}</span>
              <span>{statusCounts[option.id]}</span>
            </>
          )}
        </button>
      );
    });
  }

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-[#f3f2ee] text-gray-900 flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0 dark:bg-[#1B1D21] dark:text-slate-100">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full w-full flex flex-col overflow-hidden px-2 py-2">
          {(() => {
            const searchBoxEl = (
              <div className="relative flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/10 dark:bg-[#20242a]">
                <Search size={11} className="shrink-0 text-gray-400" />
                <input
                  type="text"
                  value={pendingSearchQuery}
                  onChange={(e) => setPendingSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); setSearchQuery(pendingSearchQuery.trim()); }
                  }}
                  placeholder="Search applications and requests"
                  className="w-full min-w-0 border-0 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:text-slate-200 dark:placeholder:text-[#64748B]"
                />
                {pendingSearchQuery && (
                  <button type="button" onClick={() => { setPendingSearchQuery(''); setSearchQuery(''); }} className="shrink-0 rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-white/10" aria-label="Clear search">
                    <X size={11} />
                  </button>
                )}
              </div>
            );

            return isMobileViewport ? (
              <div className="flex shrink-0 flex-col gap-1.5 pb-2">
                {searchBoxEl}
                <div className="flex items-center gap-1">
                  {kindFilterButtonsEl(true)}
                  {statusFilterButtonsEl(true)}
                </div>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-2 pb-2">
                <div className="flex shrink-0 items-center gap-1">
                  {kindFilterButtonsEl()}
                </div>
                <div className="min-w-[160px] flex-1">{searchBoxEl}</div>
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
            );
          })()}

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
            ) : isMobileViewport ? (
              <div className="flex flex-col gap-2 p-2">
                {rows.map((row) => {
                  if (row.kind === 'job') {
                    const turns = turnsByApplication[row.id] ?? [];
                    const hasAnsweredTurn = turns.some((t) => t.answered_at);
                    const screeningUrl = `${window.location.origin}/screen/${row.screeningToken}`;
                    return (
                      <div key={row.id} className="rounded-lg border border-[#dfdad2] bg-white p-3 dark:border-white/10 dark:bg-[#1E2126]">
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
                            <Briefcase size={9} />
                            Job
                          </span>
                          <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${APPLICATION_STATUS_STYLES[row.status] ?? APPLICATION_STATUS_STYLES.submitted}`}>
                            {APPLICATION_STATUS_LABELS[row.status] ?? row.status}
                          </span>
                          <span className="text-[11px] text-gray-400 dark:text-[#64748B]">{formatAgo(row.createdAt)}</span>
                        </div>
                        <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{row.jobTitle}</p>
                        <p className="truncate text-[11px] text-gray-400 dark:text-[#94A3B8]">
                          {row.companyName}{row.candidateName ? ` · ${row.candidateName}` : ''}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {row.aiScore !== null && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-400/30 dark:bg-purple-500/10 dark:text-purple-300">
                              <Sparkles size={9} strokeWidth={2.5} />
                              {row.aiScore}/100
                            </span>
                          )}
                          <a
                            href={screeningUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-100 dark:border-white/15 dark:bg-white/5 dark:text-slate-300"
                          >
                            <ExternalLink size={9} strokeWidth={2.5} />
                            Screening link
                          </a>
                          {hasAnsweredTurn && (
                            <button
                              type="button"
                              onClick={() => setWatchSubmissionAppId(row.id)}
                              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300"
                            >
                              <Video size={10} strokeWidth={2.5} />
                              Watch Screening
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  const isChat = row.type === 'chat';
                  return (
                    <div key={row.id} className="rounded-lg border border-[#dfdad2] bg-white p-3 dark:border-white/10 dark:bg-[#1E2126]">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-purple-400/30 bg-purple-500/10 text-purple-300' : 'border-purple-200 bg-purple-50 text-purple-700'}`}>
                          <UserRound size={9} />
                          Hotlist
                        </span>
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
                        <span className="text-[11px] text-gray-400 dark:text-[#64748B]">{formatAgo(row.createdAt)}</span>
                      </div>
                      <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">
                        {isChat ? row.subject : (row.roleTitle || 'Available Consultant')}
                      </p>
                      <p className="truncate text-[11px] text-gray-400 dark:text-[#94A3B8]">
                        {isChat ? row.ownerDisplayName : [row.candidateName, row.companyName].filter(Boolean).join(' · ')}
                      </p>
                      {isChat && (
                        <button
                          type="button"
                          onClick={() => navigate(`/inbox/${row.id}`)}
                          className="mt-2 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300"
                        >
                          <MessageSquare size={9} strokeWidth={2.5} />
                          Open chat
                        </button>
                      )}
                    </div>
                  );
                })}
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
                      const hasAnsweredTurn = turns.some((t) => t.answered_at);
                      const screeningUrl = `${window.location.origin}/screen/${row.screeningToken}`;
                      return (
                        <tr key={row.id} className={`border-b ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50'}`}>
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
                            {hasAnsweredTurn ? (
                              <button
                                type="button"
                                onClick={() => setWatchSubmissionAppId(row.id)}
                                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300"
                              >
                                <Video size={10} strokeWidth={2.5} />
                                Watch Screening
                              </button>
                            ) : <span className="text-[11px] text-gray-400 dark:text-[#64748B]">—</span>}
                          </td>
                        </tr>
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

      {watchSubmissionAppId && (
        <ScreeningSubmissionModal
          turns={turnsByApplication[watchSubmissionAppId] ?? []}
          onClose={() => setWatchSubmissionAppId(null)}
          showToast={showToast}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
