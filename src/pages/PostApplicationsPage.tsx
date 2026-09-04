import { Fragment, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, ChevronUp, FileText, Sparkles, Video, X, XCircle } from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';

interface ApplicationRow {
  id: string;
  candidate_name: string;
  candidate_email: string;
  candidate_phone: string;
  resume_url: string;
  resume_file_name: string;
  status: string;
  ai_summary: string | null;
  ai_score: number | null;
  created_at: string;
  applied_by_account_name: string | null;
  applied_by_user_email: string | null;
}

interface TurnRow {
  id: string;
  application_id: string;
  turn_index: number;
  question_text: string;
  video_stream_uid: string | null;
  transcript: string | null;
  answered_at: string | null;
}

interface JobSummary {
  job_title: string;
  company_name: string;
}

const STATUS_STYLES: Record<string, string> = {
  submitted: 'border-gray-200 bg-gray-100 text-gray-600',
  screening_sent: 'border-blue-200 bg-blue-50 text-blue-700',
  screening_completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  shortlisted: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  rejected: 'border-red-200 bg-red-50 text-red-600',
};

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  screening_sent: 'Screening sent',
  screening_completed: 'Screening complete',
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PostApplicationsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [turnsByApplication, setTurnsByApplication] = useState<Record<string, TurnRow[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);
  const [videoModal, setVideoModal] = useState<{ url: string } | null>(null);
  const [loadingVideoTurnId, setLoadingVideoTurnId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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
        .select('id, application_id, turn_index, question_text, video_stream_uid, transcript, answered_at')
        .in('application_id', appIds)
        .order('turn_index', { ascending: true });

      const grouped: Record<string, TurnRow[]> = {};
      for (const turn of (turns ?? []) as unknown as TurnRow[]) {
        (grouped[turn.application_id] ??= []).push(turn);
      }
      setTurnsByApplication(grouped);
    }

    setLoading(false);
  }, [jobId, showToast]);

  useEffect(() => { void loadApplications(); }, [loadApplications]);

  async function handleDecision(applicationId: string, status: 'shortlisted' | 'rejected') {
    setDecisionBusyId(applicationId);
    const { error } = await supabase.rpc('set_job_application_decision' as never, {
      p_application_id: applicationId,
      p_status: status,
    } as never);
    setDecisionBusyId(null);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    setApplications((prev) => prev.map((a) => (a.id === applicationId ? { ...a, status } : a)));
    showToast(status === 'shortlisted' ? 'Candidate shortlisted' : 'Candidate rejected', 'success');
  }

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
            ) : (
              <table className="w-full min-w-[900px] border-collapse text-left text-[12px]">
                <thead>
                  <tr className={`sticky top-0 z-10 border-b ${isDark ? 'border-white/10 bg-[#20242a]' : 'border-gray-200 bg-gray-50'}`}>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Candidate</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Status</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Match Score</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Applied By</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Applied Date</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Resume</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Screening</th>
                    <th className="px-3 py-2 font-semibold text-gray-500 dark:text-[#94A3B8]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app) => {
                    const turns = turnsByApplication[app.id] ?? [];
                    const isExpanded = expandedId === app.id;
                    return (
                      <Fragment key={app.id}>
                        <tr className={`border-b ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50'}`}>
                          <td className="px-3 py-2.5 align-top">
                            <p className="font-semibold text-gray-900 dark:text-slate-100">{app.candidate_name}</p>
                            <p className="text-[11px] text-gray-400 dark:text-[#94A3B8]">{app.candidate_email}</p>
                            {app.candidate_phone && <p className="text-[11px] text-gray-400 dark:text-[#94A3B8]">{app.candidate_phone}</p>}
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[app.status] ?? STATUS_STYLES.submitted}`}>
                              {STATUS_LABELS[app.status] ?? app.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            {app.ai_score !== null ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-400/30 dark:bg-purple-500/10 dark:text-purple-300">
                                <Sparkles size={9} strokeWidth={2.5} />
                                {app.ai_score}/100
                              </span>
                            ) : (
                              <span className="text-[11px] text-gray-400 dark:text-[#64748B]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <p className="text-gray-700 dark:text-slate-300">{app.applied_by_account_name || '—'}</p>
                            <p className="text-[11px] text-gray-400 dark:text-[#94A3B8]">{app.applied_by_user_email}</p>
                          </td>
                          <td className="px-3 py-2.5 align-top text-gray-500 dark:text-[#94A3B8]">{formatDate(app.created_at)}</td>
                          <td className="px-3 py-2.5 align-top">
                            {app.resume_url ? (
                              <a
                                href={app.resume_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-100 dark:border-white/15 dark:bg-white/5 dark:text-slate-300"
                              >
                                <FileText size={9} strokeWidth={2.5} />
                                Resume
                              </a>
                            ) : <span className="text-[11px] text-gray-400 dark:text-[#64748B]">—</span>}
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            {turns.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setExpandedId(isExpanded ? null : app.id)}
                                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                              >
                                {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                {turns.filter((t) => t.answered_at).length}/{turns.length}
                              </button>
                            ) : <span className="text-[11px] text-gray-400 dark:text-[#64748B]">—</span>}
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            {app.status !== 'shortlisted' && app.status !== 'rejected' ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={decisionBusyId === app.id}
                                  onClick={() => void handleDecision(app.id, 'shortlisted')}
                                  title="Shortlist"
                                  className="rounded p-1 text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  type="button"
                                  disabled={decisionBusyId === app.id}
                                  onClick={() => void handleDecision(app.id, 'rejected')}
                                  title="Reject"
                                  className="rounded p-1 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
                                >
                                  <XCircle size={14} />
                                </button>
                              </div>
                            ) : <span className="text-[11px] text-gray-400 dark:text-[#64748B]">—</span>}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className={isDark ? 'bg-white/[0.02]' : 'bg-gray-50/60'}>
                            <td colSpan={8} className="px-3 py-3">
                              {app.ai_summary && (
                                <div className="mb-3 rounded-md border border-purple-100 bg-purple-50/60 p-2.5 dark:border-purple-400/20 dark:bg-purple-500/5">
                                  <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300">
                                    <Sparkles size={10} strokeWidth={2.5} />
                                    AI Summary
                                  </p>
                                  <p className="text-[12px] leading-relaxed text-gray-700 dark:text-slate-300">{app.ai_summary}</p>
                                </div>
                              )}
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
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {videoModal && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setVideoModal(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-lg bg-black shadow-2xl">
            <div className="flex items-center justify-end p-1.5">
              <button
                type="button"
                onClick={() => setVideoModal(null)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/80 hover:bg-white/10"
                aria-label="Close video"
              >
                <X size={16} />
              </button>
            </div>
            <div className="aspect-video w-full">
              <iframe
                src={videoModal.url}
                className="h-full w-full"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
