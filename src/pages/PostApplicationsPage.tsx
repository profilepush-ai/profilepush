import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, FileText, MessageSquare, Sparkles, Video, XCircle } from 'lucide-react';
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
  submitted: 'Submitted',
  screening_sent: 'Screening sent',
  screening_completed: 'Screening complete',
  qualified: 'Qualified',
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
  const [turnsByApplication, setTurnsByApplication] = useState<Record<string, ScreeningTurn[]>>({});
  const [watchSubmissionAppId, setWatchSubmissionAppId] = useState<string | null>(null);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);
  const [chatBusyId, setChatBusyId] = useState<string | null>(null);
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
        .select('id, application_id, turn_index, question_text, video_stream_uid, answered_at')
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

  async function handleDecision(applicationId: string, status: 'qualified' | 'rejected') {
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
    showToast(status === 'qualified' ? 'Candidate qualified' : 'Candidate rejected', 'success');
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
                    const isDecided = app.status === 'qualified' || app.status === 'rejected';
                    return (
                      <tr key={app.id} className={`border-b ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50'}`}>
                        <td className="px-3 py-2.5 align-top">
                          <p className="font-semibold text-gray-900 dark:text-slate-100">{app.candidate_name || 'Unnamed candidate'}</p>
                          {app.candidate_email && <p className="text-[11px] text-gray-400 dark:text-[#94A3B8]">{app.candidate_email}</p>}
                          {app.candidate_phone && <p className="text-[11px] text-gray-400 dark:text-[#94A3B8]">{app.candidate_phone}</p>}
                          {app.recruiter_note && (
                            <p className="mt-1 max-w-[220px] truncate text-[11px] italic text-gray-500 dark:text-[#94A3B8]" title={app.recruiter_note}>
                              “{app.recruiter_note}”
                            </p>
                          )}
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
                              onClick={() => setWatchSubmissionAppId(app.id)}
                              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300"
                            >
                              <Video size={10} strokeWidth={2.5} />
                              Watch Submission
                            </button>
                          ) : <span className="text-[11px] text-gray-400 dark:text-[#64748B]">—</span>}
                          {app.ai_summary && (
                            <p className="mt-1 max-w-[200px] truncate text-[11px] text-gray-400 dark:text-[#64748B]" title={app.ai_summary}>
                              {app.ai_summary}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex items-center gap-1">
                            {!isDecided && (
                              <>
                                <button
                                  type="button"
                                  disabled={decisionBusyId === app.id}
                                  onClick={() => void handleDecision(app.id, 'qualified')}
                                  title="Qualify"
                                  className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                                >
                                  <Check size={12} />
                                  Qualify
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
                              </>
                            )}
                            <button
                              type="button"
                              disabled={chatBusyId === app.id}
                              onClick={() => void handleChat(app.id)}
                              title="Chat with the submitting recruiter"
                              className="rounded p-1 text-blue-500 transition-colors hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
                            >
                              {chatBusyId === app.id ? <LogoSpinner size={12} /> : <MessageSquare size={14} />}
                            </button>
                          </div>
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
          turns={watchSubmissionTurns}
          onClose={() => setWatchSubmissionAppId(null)}
          showToast={showToast}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
