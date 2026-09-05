import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, FileText, MessageSquare, Sparkles, Video, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import ScreeningSubmissionModal, { type ScreeningTurn } from '../components/ScreeningSubmissionModal';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';

interface ApplicationRow {
  id: string;
  candidate_name: string;
  candidate_email: string;
  candidate_phone: string;
  resume_url: string;
  resume_file_name: string;
  recruiter_note: string;
  status: string;
  ai_summary: string | null;
  ai_score: number | null;
  created_at: string;
  applied_by_account_name: string | null;
  applied_by_user_email: string | null;
}

interface JobSummary {
  job_title: string;
  company_name: string;
}

const STATUS_STYLES: Record<string, string> = {
  submitted: 'border-gray-200 bg-gray-100 text-gray-600',
  screening_sent: 'border-blue-200 bg-blue-50 text-blue-700',
  screening_completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  qualified: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  rejected: 'border-red-200 bg-red-50 text-red-600',
};

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Applied',
  screening_sent: 'Screening Sent',
  screening_completed: 'Screening Submitted',
  qualified: 'Qualified',
  rejected: 'Rejected',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PostApplicationsPage() {
  const { jobId, applicationId: selectedApplicationId } = useParams<{ jobId: string; applicationId?: string }>();
  const navigate = useNavigate();
  const { isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [turnsByApplication, setTurnsByApplication] = useState<Record<string, ScreeningTurn[]>>({});
  const [watchSubmissionAppId, setWatchSubmissionAppId] = useState<string | null>(null);
  const [resumeModalUrl, setResumeModalUrl] = useState<string | null>(null);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);
  const [chatBusyId, setChatBusyId] = useState<string | null>(null);
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

  const loadApplications = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);

    const [jobResult, appsResult] = await Promise.all([
      supabase.from('social_jobs').select('job_title, company_name').eq('id', jobId).maybeSingle(),
      supabase.rpc('get_post_applications' as never, { p_social_job_id: jobId } as never),
    ]);

    if (jobResult.data) setJob(jobResult.data as JobSummary);

    if (appsResult.error) {
      showToast(appsResult.error.message, 'error');
      setLoading(false);
      return;
    }

    const appRows = (appsResult.data ?? []) as unknown as ApplicationRow[];
    setApplications(appRows);

    const appIds = appRows.map((a) => a.id);
    if (appIds.length > 0) {
      const { data: turns } = await supabase
        .from('job_application_screening_turns')
        .select('id, application_id, turn_index, question_text, video_offset_ms, answered_at')
        .in('application_id', appIds)
        .order('turn_index', { ascending: true });

      const grouped: Record<string, ScreeningTurn[]> = {};
      for (const turn of (turns ?? []) as unknown as Array<ScreeningTurn & { application_id: string }>) {
        (grouped[turn.application_id] ??= []).push(turn);
      }
      setTurnsByApplication(grouped);
    }

    setLoading(false);
  }, [jobId, showToast]);

  useEffect(() => { void loadApplications(); }, [loadApplications]);

  async function handleQualify(applicationId: string) {
    setDecisionBusyId(applicationId);
    const { error } = await supabase.rpc('set_job_application_decision' as never, {
      p_application_id: applicationId,
      p_status: 'qualified',
    } as never);
    setDecisionBusyId(null);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    setApplications((prev) => prev.map((a) => (a.id === applicationId ? { ...a, status: 'qualified' } : a)));
    showToast('Candidate qualified', 'success');
  }

  async function handleChat(applicationId: string) {
    setChatBusyId(applicationId);
    const { data, error } = await supabase.rpc('start_application_chat' as never, {
      p_application_id: applicationId,
    } as never);
    setChatBusyId(null);
    if (error || !data) {
      showToast(error?.message || 'Could not start the conversation', 'error');
      return;
    }
    navigate(`/inbox/${data as string}`);
  }

  const watchSubmissionTurns = watchSubmissionAppId ? (turnsByApplication[watchSubmissionAppId] ?? []) : [];

  // Desktop detail-panel selection is route-driven (mirrors /feed's Detail
  // layout and InboxPage's /inbox/:conversationId) — a real, back/forward-
  // able, refresh-safe URL per application, not local component state.
  // Mobile keeps its own separate card layout + popups (watchSubmissionAppId
  // / resumeModalUrl below) entirely untouched.
  const selectedApp = selectedApplicationId ? applications.find((a) => a.id === selectedApplicationId) ?? null : null;
  const selectedTurns = selectedApp ? (turnsByApplication[selectedApp.id] ?? []) : [];
  const selectedHasAnsweredTurn = selectedTurns.some((t) => t.answered_at);
  const selectedScreeningSubmitted = selectedApp ? (selectedApp.status === 'screening_completed' || selectedApp.status === 'qualified') : false;

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-[#f3f2ee] text-gray-900 flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0 dark:bg-[#1B1D21] dark:text-slate-100">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full w-full flex flex-col overflow-hidden px-2 py-2">
          <div className="mb-2 flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/posts')}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${isDark ? 'text-slate-300 hover:bg-white/10' : 'text-gray-600 hover:bg-gray-200'}`}
              aria-label="Back to Posts"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-bold text-gray-900 dark:text-slate-100">
                Applications{job?.job_title ? ` — ${job.job_title}` : ''}
              </h1>
              {job?.company_name && <p className="truncate text-[12px] text-gray-400 dark:text-[#94A3B8]">{job.company_name}</p>}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[#dfdad2] bg-white dark:border-white/10 dark:bg-[#1E2126]">
            {loading ? (
              <div className="flex items-center justify-center py-16"><LogoSpinner size={20} /></div>
            ) : applications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-[13px] font-semibold text-gray-500 dark:text-slate-400">No applications yet</p>
                <p className="mt-1 text-[12px] text-gray-400 dark:text-[#64748B]">Applications submitted for this job will show up here.</p>
              </div>
            ) : isMobileViewport ? (
              <div className="flex flex-col gap-2 p-2">
                {applications.map((app) => {
                  const turns = turnsByApplication[app.id] ?? [];
                  const hasAnsweredTurn = turns.some((t) => t.answered_at);
                  const screeningSubmitted = app.status === 'screening_completed' || app.status === 'qualified';
                  return (
                    <div key={app.id} className="rounded-lg border border-[#dfdad2] bg-white p-3 dark:border-white/10 dark:bg-[#1E2126]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{app.candidate_name || 'Unnamed candidate'}</p>
                          {app.candidate_email && <p className="truncate text-[11px] text-gray-400 dark:text-[#94A3B8]">{app.candidate_email}</p>}
                          {app.candidate_phone && <p className="text-[11px] text-gray-400 dark:text-[#94A3B8]">{app.candidate_phone}</p>}
                        </div>
                        <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[app.status] ?? STATUS_STYLES.submitted}`}>
                          {STATUS_LABELS[app.status] ?? app.status}
                        </span>
                      </div>

                      {app.recruiter_note && (
                        <p className="mt-1 truncate text-[11px] italic text-gray-500 dark:text-[#94A3B8]" title={app.recruiter_note}>
                          “{app.recruiter_note}”
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {app.ai_score !== null && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-400/30 dark:bg-purple-500/10 dark:text-purple-300">
                            <Sparkles size={9} strokeWidth={2.5} />
                            {app.ai_score}/100
                          </span>
                        )}
                        {screeningSubmitted && app.status !== 'qualified' && (
                          <button
                            type="button"
                            disabled={decisionBusyId === app.id}
                            onClick={() => void handleQualify(app.id)}
                            title="Qualify"
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                          >
                            <Check size={9} strokeWidth={2.5} />
                            Qualify
                          </button>
                        )}
                      </div>

                      {app.ai_summary && (
                        <p className="mt-1.5 text-[11px] text-gray-400 dark:text-[#64748B]">{app.ai_summary}</p>
                      )}

                      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-[11px] text-gray-400 dark:border-white/10 dark:text-[#64748B]">
                        <span>{app.applied_by_account_name || '—'} · {formatDate(app.created_at)}</span>
                      </div>

                      <div className="mt-2 flex items-center gap-1">
                        <button
                          type="button"
                          disabled={!app.resume_url}
                          onClick={() => setResumeModalUrl(app.resume_url)}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/5 dark:text-slate-300"
                        >
                          <FileText size={12} />
                          Resume
                        </button>
                        <button
                          type="button"
                          disabled={!hasAnsweredTurn}
                          onClick={() => setWatchSubmissionAppId(app.id)}
                          title="Watch Screening"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300"
                        >
                          <Video size={14} />
                        </button>
                        <button
                          type="button"
                          disabled={chatBusyId === app.id}
                          onClick={() => void handleChat(app.id)}
                          title="Chat with the submitting recruiter"
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-400"
                        >
                          {chatBusyId === app.id ? <LogoSpinner size={12} /> : <MessageSquare size={12} />}
                          Chat
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_380px] gap-3 p-2">
                {/* Plain block stacking, not CSS grid, for this list column —
                    a grid's "auto" row-sizing pass measures nested-flex
                    content by min-content rather than actual rendered
                    height (found and fixed the same bug in PulsePage's
                    detail layout: every row collapsed and overlapped). */}
                <div className="min-h-0 space-y-1.5 overflow-y-auto pr-1">
                  {applications.map((app) => {
                    const isSelected = selectedApp?.id === app.id;
                    return (
                      <button
                        key={app.id}
                        type="button"
                        onClick={() => navigate(`/posts/applications/${jobId}/${app.id}`, { replace: true })}
                        className={`block w-full rounded-md border px-3 py-2.5 text-left transition-colors ${isSelected ? 'border-blue-300 bg-blue-50 dark:border-blue-400/40 dark:bg-blue-500/10' : 'border-transparent bg-white hover:bg-gray-50 dark:bg-[#1E2126] dark:hover:bg-white/5'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{app.candidate_name || 'Unnamed candidate'}</p>
                            {app.candidate_email && <p className="truncate text-[11px] text-gray-400 dark:text-[#94A3B8]">{app.candidate_email}</p>}
                          </div>
                          <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[app.status] ?? STATUS_STYLES.submitted}`}>
                            {STATUS_LABELS[app.status] ?? app.status}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400 dark:text-[#94A3B8]">
                          {app.ai_score !== null && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-400/30 dark:bg-purple-500/10 dark:text-purple-300">
                              <Sparkles size={9} strokeWidth={2.5} />
                              {app.ai_score}/100
                            </span>
                          )}
                          <span>{app.applied_by_account_name || '—'} · {formatDate(app.created_at)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-[#1E2126]">
                  {!selectedApp ? (
                    <div className="flex flex-1 items-center justify-center p-6 text-center">
                      <p className="text-[13px] text-gray-400 dark:text-[#64748B]">Select an application to review</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2.5 border-b border-gray-100 p-4 dark:border-white/10">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-semibold text-gray-900 dark:text-slate-100">{selectedApp.candidate_name || 'Unnamed candidate'}</p>
                          {(selectedApp.candidate_email || selectedApp.candidate_phone) && (
                            <p className="truncate text-[12px] text-gray-500 dark:text-[#94A3B8]">
                              {selectedApp.candidate_email}{selectedApp.candidate_email && selectedApp.candidate_phone ? ' · ' : ''}{selectedApp.candidate_phone}
                            </p>
                          )}
                          <span className={`mt-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[selectedApp.status] ?? STATUS_STYLES.submitted}`}>
                            {STATUS_LABELS[selectedApp.status] ?? selectedApp.status}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => navigate(`/posts/applications/${jobId}`, { replace: true })}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
                          aria-label="Close"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        {selectedApp.ai_summary && (
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#94A3B8]">AI Summary</p>
                            <p className="text-[13px] leading-relaxed text-gray-700 dark:text-slate-300">{selectedApp.ai_summary}</p>
                          </div>
                        )}

                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#94A3B8]">Screening Video</p>
                          {selectedHasAnsweredTurn ? (
                            <ScreeningSubmissionModal
                              embedded
                              applicationId={selectedApp.id}
                              turns={selectedTurns}
                              onClose={() => {}}
                              showToast={showToast}
                            />
                          ) : (
                            <p className="text-[12px] text-gray-400 dark:text-[#64748B]">No screening recorded yet.</p>
                          )}
                        </div>

                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#94A3B8]">Resume</p>
                          {selectedApp.resume_url ? (
                            <iframe src={selectedApp.resume_url} className="h-[500px] w-full rounded-md border border-gray-200 bg-white dark:border-white/10" title="Resume" />
                          ) : (
                            <p className="text-[12px] text-gray-400 dark:text-[#64748B]">No resume on file.</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 border-t border-gray-100 p-3 dark:border-white/10">
                        <button
                          type="button"
                          disabled={chatBusyId === selectedApp.id}
                          onClick={() => void handleChat(selectedApp.id)}
                          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 text-[12px] font-semibold text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-400"
                        >
                          {chatBusyId === selectedApp.id ? <LogoSpinner size={14} /> : <MessageSquare size={14} />}
                          Chat
                        </button>
                        {selectedScreeningSubmitted && selectedApp.status !== 'qualified' && (
                          <button
                            type="button"
                            disabled={decisionBusyId === selectedApp.id}
                            onClick={() => void handleQualify(selectedApp.id)}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {decisionBusyId === selectedApp.id ? <LogoSpinner size={14} /> : <Check size={14} />}
                            Qualify
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </aside>
              </div>
            )}
          </div>
        </div>
      </main>

      {watchSubmissionAppId && (
        <ScreeningSubmissionModal
          applicationId={watchSubmissionAppId}
          turns={watchSubmissionTurns}
          onClose={() => setWatchSubmissionAppId(null)}
          showToast={showToast}
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
