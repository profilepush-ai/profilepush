import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Filter, FileText, Search, Send, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import SubmitHotlistResumeModal from '../components/SubmitHotlistResumeModal';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';

// Mirrors PostApplicationsPage.tsx (the Jobs-side equivalent) but for a
// Bench Sales recruiter viewing resume Requests made against their own
// Hotlist post, and responding with a Submission. Deliberately simpler:
// no screening/AI-score concepts (those are Jobs-specific), no chat button
// (a dedicated per-request thread is a separate fast-follow — the general
// Hotlist chat and Tracker already cover ongoing conversation for now).

interface RequestRow {
  request_id: string;
  status: string;
  missing_details: string[];
  submission_resume_url: string | null;
  submission_resume_file_name: string | null;
  submission_note: string | null;
  fulfilled_at: string | null;
  created_at: string;
  requested_by_account_name: string | null;
  requested_by_user_email: string | null;
}

interface HotlistSummary {
  role_title: string;
  candidate_name: string;
  visa_type: string;
  employment_type: string;
  work_type: string;
  hourly_rate_min: number | null;
  hourly_rate_max: number | null;
}

const STATUS_STYLES: Record<string, string> = {
  processing: 'border-gray-200 bg-gray-100 text-gray-600',
  charged: 'border-gray-200 bg-gray-100 text-gray-600',
  completed: 'border-blue-200 bg-blue-50 text-blue-700',
  fulfilled: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  failed: 'border-red-200 bg-red-50 text-red-600',
  refunded: 'border-red-200 bg-red-50 text-red-600',
};

const STATUS_LABELS: Record<string, string> = {
  processing: 'Requesting…',
  charged: 'Requesting…',
  completed: 'Awaiting Resume',
  fulfilled: 'Resume Sent',
  failed: 'Failed',
  refunded: 'Refunded',
};

const STATUS_TABS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Awaiting Resume' },
  { id: 'fulfilled', label: 'Resume Sent' },
  { id: 'failed', label: 'Failed' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HotlistRequestsPage() {
  const { hotlistId } = useParams<{ hotlistId: string }>();
  const navigate = useNavigate();
  const { isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [hotlist, setHotlist] = useState<HotlistSummary | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const [resumeModalUrl, setResumeModalUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);

  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    if (!isStatusMenuOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (statusMenuRef.current && target && !statusMenuRef.current.contains(target)) {
        setIsStatusMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isStatusMenuOpen]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => setToast({ message, type }), []);

  const loadRequests = useCallback(async () => {
    if (!hotlistId) return;
    setLoading(true);

    const [hotlistResult, requestsResult] = await Promise.all([
      supabase.from('social_hotlist').select('role_title, candidate_name, visa_type, employment_type, work_type, hourly_rate_min, hourly_rate_max').eq('id', hotlistId).maybeSingle(),
      supabase.rpc('get_hotlist_post_requests' as never, { p_hotlist_id: hotlistId } as never),
    ]);

    if (hotlistResult.data) setHotlist(hotlistResult.data as HotlistSummary);

    if (requestsResult.error) {
      showToast(requestsResult.error.message, 'error');
      setLoading(false);
      return;
    }

    setRequests((requestsResult.data ?? []) as unknown as RequestRow[]);
    setLoading(false);
  }, [hotlistId, showToast]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  const respondingRequest = respondingRequestId ? requests.find((r) => r.request_id === respondingRequestId) ?? null : null;

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredRequests = requests.filter((req) => {
    if (statusFilter !== 'all' && req.status !== statusFilter) return false;
    if (!normalizedSearch) return true;
    return (
      req.requested_by_account_name?.toLowerCase().includes(normalizedSearch) ||
      req.requested_by_user_email?.toLowerCase().includes(normalizedSearch)
    );
  });

  const rateText = hotlist && (hotlist.hourly_rate_min || hotlist.hourly_rate_max)
    ? `$${hotlist.hourly_rate_min ?? '?'}-${hotlist.hourly_rate_max ?? '?'}/hr`
    : '';

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-[#f3f2ee] text-gray-900 flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0 dark:bg-[#1B1D21] dark:text-slate-100">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full w-full flex flex-col overflow-hidden px-2 py-2">
          <div className="mb-2 flex shrink-0 items-start gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/posts')}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${isDark ? 'text-slate-300 hover:bg-white/10' : 'text-gray-600 hover:bg-gray-200'}`}
              aria-label="Back to Posts"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <h1 className="text-[15px] font-bold leading-snug text-gray-900 dark:text-slate-100">
                Requests{hotlist?.role_title ? ` — ${hotlist.role_title}` : ''}
              </h1>
              {hotlist && (
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  {[hotlist.visa_type, hotlist.employment_type, hotlist.work_type, rateText]
                    .filter(Boolean)
                    .map((detail) => (
                      <span
                        key={detail}
                        className="inline-flex items-center rounded-full border border-[#dfdad2] bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-[#94A3B8]"
                      >
                        {detail}
                      </span>
                    ))}
                </div>
              )}
            </div>
          </div>

          {!loading && requests.length > 0 && (
            <div className="mb-2 flex shrink-0 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search requests..."
                  className="w-full rounded-md border border-[#dfdad2] bg-white py-1.5 pl-8 pr-3 text-[12px] text-gray-700 outline-none focus:border-blue-300 dark:border-white/10 dark:bg-[#1E2126] dark:text-slate-200"
                />
              </div>
              <div ref={statusMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setIsStatusMenuOpen((prev) => !prev)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${statusFilter !== 'all' ? 'border-blue-600 bg-blue-600 text-white' : 'border-[#dfdad2] bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-[#1E2126] dark:text-[#94A3B8] dark:hover:bg-white/5'}`}
                  aria-label="Filter by status"
                >
                  <Filter size={12} />
                  <span>{STATUS_TABS.find((tab) => tab.id === statusFilter)?.label ?? 'All'}</span>
                </button>

                {isStatusMenuOpen && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[190px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#20242a]">
                    {STATUS_TABS.map((tab) => {
                      const count = tab.id === 'all' ? requests.length : requests.filter((r) => r.status === tab.id).length;
                      const isActive = statusFilter === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => { setStatusFilter(tab.id); setIsStatusMenuOpen(false); }}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${isActive ? (isDark ? 'bg-[#2A2E35] text-slate-100' : 'bg-gray-100 text-gray-800') : (isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-600 hover:bg-gray-50')}`}
                        >
                          <span>{tab.label} · {count}</span>
                          {isActive ? <Check size={11} /> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={`min-h-0 flex-1 overflow-auto ${isMobileViewport ? '' : 'rounded-lg border border-[#dfdad2] bg-white dark:border-white/10 dark:bg-[#1E2126]'}`}>
            {loading ? (
              <div className="flex items-center justify-center py-16"><LogoSpinner size={20} /></div>
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-[13px] font-semibold text-gray-500 dark:text-slate-400">No requests yet</p>
                <p className="mt-1 text-[12px] text-gray-400 dark:text-[#64748B]">When a vendor asks for a resume on this post, it'll show up here.</p>
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-[13px] font-semibold text-gray-500 dark:text-slate-400">No matching requests</p>
                <p className="mt-1 text-[12px] text-gray-400 dark:text-[#64748B]">Try a different search term or status filter.</p>
              </div>
            ) : (
              <div className={`flex flex-col gap-2 ${isMobileViewport ? '' : 'p-2'}`}>
                {filteredRequests.map((req) => {
                  const isFulfilled = req.status === 'fulfilled';
                  const canRespond = req.status === 'completed';
                  return (
                    <div key={req.request_id} className="rounded-lg border border-[#dfdad2] bg-white p-3 dark:border-white/10 dark:bg-[#1E2126]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{req.requested_by_account_name || 'A vendor'}</p>
                          {req.requested_by_user_email && <p className="truncate text-[11px] text-gray-400 dark:text-[#94A3B8]">{req.requested_by_user_email}</p>}
                        </div>
                        <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[req.status] ?? STATUS_STYLES.completed}`}>
                          {STATUS_LABELS[req.status] ?? req.status}
                        </span>
                      </div>

                      {req.submission_note && (
                        <p className="mt-1 text-[11px] italic text-gray-500 dark:text-[#94A3B8]">“{req.submission_note}”</p>
                      )}

                      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-[11px] text-gray-400 dark:border-white/10 dark:text-[#64748B]">
                        <span>{formatDate(req.created_at)}</span>
                      </div>

                      {canRespond && (
                        <button
                          type="button"
                          onClick={() => setRespondingRequestId(req.request_id)}
                          className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700"
                        >
                          <Send size={12} />
                          Respond
                        </button>
                      )}
                      {isFulfilled && req.submission_resume_url && (
                        <button
                          type="button"
                          onClick={() => setResumeModalUrl(req.submission_resume_url)}
                          className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 dark:border-white/15 dark:bg-white/5 dark:text-slate-300"
                        >
                          <FileText size={12} />
                          View Resume Sent
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {respondingRequest && (
        <SubmitHotlistResumeModal
          requestId={respondingRequest.request_id}
          roleTitle={hotlist?.role_title || 'this request'}
          onClose={() => setRespondingRequestId(null)}
          onSubmitted={() => { setRespondingRequestId(null); void loadRequests(); }}
        />
      )}

      {resumeModalUrl && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setResumeModalUrl(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-[#1B1D21]">
            <div className="flex items-center justify-between border-b border-gray-100 p-3 dark:border-white/10">
              <p className="text-[12px] font-semibold text-gray-700 dark:text-slate-200">Resume</p>
              <button
                type="button"
                onClick={() => setResumeModalUrl(null)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
                aria-label="Close resume"
              >
                <X size={14} />
              </button>
            </div>
            <iframe src={resumeModalUrl} className="flex-1 w-full bg-white" title="Resume" />
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
