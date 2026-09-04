import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, FileText, Sparkles, User, Video, X, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import LogoSpinner from '../LogoSpinner';

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

interface ApplicationsModalProps {
  jobId: string;
  jobTitle: string;
  onClose: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
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

export default function ApplicationsModal({ jobId, jobTitle, onClose, showToast }: ApplicationsModalProps) {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [turnsByApplication, setTurnsByApplication] = useState<Record<string, TurnRow[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);
  const [videoModal, setVideoModal] = useState<{ url: string } | null>(null);
  const [loadingVideoTurnId, setLoadingVideoTurnId] = useState<string | null>(null);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    const { data: apps, error } = await supabase
      .from('job_applications')
      .select('id, candidate_name, candidate_email, candidate_phone, resume_url, resume_file_name, status, ai_summary, ai_score, created_at')
      .eq('social_job_id', jobId)
      .order('created_at', { ascending: false });

    if (error) {
      showToast('Could not load applications', 'error');
      setLoading(false);
      return;
    }

    const appRows = (apps ?? []) as unknown as ApplicationRow[];
    setApplications(appRows);

    const appIds = appRows.map((a) => a.id);
    if (appIds.length > 0) {
      const { data: turns } = await supabase
        .from('job_application_screening_turns')
        .select('id, application_id, turn_index, question_text, video_stream_uid, transcript, answered_at')
        .in('application_id', appIds)
        .order('turn_index', { ascending: true });

      const grouped: Record<string, TurnRow[]> = {};
      for (const turn of (turns ?? []) as TurnRow[]) {
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="applications-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#20242a]"
      >
        <div className="flex items-start gap-2.5 border-b border-gray-100 p-4 dark:border-white/10">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
            <User size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="applications-modal-title" className="truncate text-[15px] font-semibold text-gray-900 dark:text-slate-100">
              Applications
            </h2>
            <p className="truncate text-[12px] text-gray-400 dark:text-[#94A3B8]">{jobTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
            aria-label="Close applications"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16"><LogoSpinner size={20} /></div>
          ) : applications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-[13px] font-semibold text-gray-500 dark:text-slate-400">No applications yet</p>
              <p className="mt-1 text-[12px] text-gray-400 dark:text-[#64748B]">Applications submitted for this job will show up here.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {applications.map((app) => {
                const turns = turnsByApplication[app.id] ?? [];
                const isExpanded = expandedId === app.id;
                return (
                  <div key={app.id} className="rounded-lg border border-[#dfdad2] bg-white dark:border-white/10 dark:bg-[#1E2126]">
                    <div className="flex items-start justify-between gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{app.candidate_name}</p>
                        <p className="truncate text-[11px] text-gray-400 dark:text-[#94A3B8]">{app.candidate_email}{app.candidate_phone ? ` · ${app.candidate_phone}` : ''}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[app.status] ?? STATUS_STYLES.submitted}`}>
                            {STATUS_LABELS[app.status] ?? app.status}
                          </span>
                          {app.ai_score !== null && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-400/30 dark:bg-purple-500/10 dark:text-purple-300">
                              <Sparkles size={9} strokeWidth={2.5} />
                              Score {app.ai_score}/10
                            </span>
                          )}
                          {app.resume_url && (
                            <a
                              href={app.resume_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-100 dark:border-white/15 dark:bg-white/5 dark:text-slate-300"
                            >
                              <FileText size={9} strokeWidth={2.5} />
                              Resume
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {app.status !== 'shortlisted' && app.status !== 'rejected' && (
                          <>
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
                          </>
                        )}
                        {turns.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : app.id)}
                            title={isExpanded ? 'Hide screening' : 'View screening'}
                            className={`rounded p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-100 p-3 dark:border-white/10">
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
                            <div key={turn.id} className="rounded-md border border-gray-100 p-2.5 dark:border-white/10">
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

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
    </div>
  );
}
