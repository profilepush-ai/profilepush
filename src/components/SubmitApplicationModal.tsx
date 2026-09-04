import { useState } from 'react';
import { Check, Copy, PartyPopper, RefreshCw, Send, Upload, Video, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';

// Lets a recruiter submit one of their bench consultants to a self-posted
// job they see in the Feed (cross-account by design — the job doesn't have
// to be one this account posted). No candidate-detail fields — resume
// upload + an optional note is all that's asked; candidate name/email/phone
// are derived from the resume itself (parse-resume, Cloudflare Workers AI)
// rather than typed in, since the recruiter usually doesn't have (or
// shouldn't need to re-type) that information by hand.
//
// After submission the modal stays open through a "preparing" step (parsing
// + generating the first AI screening question) and lands on a "ready"
// state offering Start Screening / Share Screening Link, since the
// candidate's screening_token only becomes useful once a first question
// exists.

type Step = 'form' | 'submitting' | 'preparing' | 'ready' | 'error';

interface ParsedResumeFields {
  candidate_name?: string;
  email?: string;
  phone?: string;
  [key: string]: unknown;
}

export default function SubmitApplicationModal({
  jobId,
  jobTitle,
  onClose,
  onSaved,
  showToast,
}: {
  jobId: string;
  jobTitle: string;
  onClose: () => void;
  onSaved: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const { isDark } = useTheme();
  const [step, setStep] = useState<Step>('form');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [screeningUrl, setScreeningUrl] = useState('');
  const [justCopied, setJustCopied] = useState(false);

  const inputClass = `w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none transition-colors focus:ring-2 ${
    isDark
      ? 'border-white/15 bg-[#171a1f] text-slate-100 placeholder:text-[#64748B] focus:border-blue-500 focus:ring-blue-500/20'
      : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:ring-blue-100'
  }`;
  const labelClass = `mb-1 block text-[11px] font-semibold ${isDark ? 'text-[#94A3B8]' : 'text-gray-600'}`;

  async function parseResumeBestEffort(file: File): Promise<ParsedResumeFields | null> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('resume', file, file.name);
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/parse-resume`, { method: 'POST', headers, body: formData });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.queued) return null;
      return data as ParsedResumeFields;
    } catch {
      return null;
    }
  }

  async function runPrepareScreening(id: string) {
    setStep('preparing');
    const { error } = await supabase.functions.invoke('process-job-application', {
      body: { applicationId: id },
    });
    if (error) {
      setErrorMessage(error.message || 'Could not prepare the screening');
      setStep('error');
      return;
    }
    setStep('ready');
  }

  async function handleSubmit() {
    if (!resumeFile) {
      showToast('A resume upload is required', 'error');
      return;
    }

    setStep('submitting');
    try {
      const storagePath = `applications/${crypto.randomUUID()}-${resumeFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from('resumes')
        .upload(storagePath, resumeFile, { contentType: resumeFile.type || 'application/octet-stream' });
      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);

      const parsed = await parseResumeBestEffort(resumeFile);

      const { data: rpcData, error } = await supabase.rpc('submit_job_application' as never, {
        p_social_job_id: jobId,
        p_candidate_name: parsed?.candidate_name ?? '',
        p_candidate_email: parsed?.email ?? '',
        p_candidate_phone: parsed?.phone ?? '',
        p_resume_url: urlData.publicUrl,
        p_resume_file_name: resumeFile.name,
        p_recruiter_note: note.trim(),
        p_resume_parsed_json: parsed ?? null,
      } as never);
      if (error) throw new Error(error.message);

      const row = (rpcData as unknown as Array<{ id: string; screening_token: string }> | null)?.[0];
      if (!row) throw new Error('Could not create the application');

      setApplicationId(row.id);
      setScreeningUrl(`${window.location.origin}/screen/${row.screening_token}`);
      onSaved();
      await runPrepareScreening(row.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not submit application');
      setStep('error');
    }
  }

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Video screening for ${jobTitle}`, url: screeningUrl });
        return;
      } catch {
        // fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(screeningUrl);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
    } catch {
      showToast('Could not copy the link', 'error');
    }
  }

  const busy = step === 'submitting' || step === 'preparing';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div
        className={`w-full max-w-md rounded-lg border p-4 shadow-xl ${isDark ? 'border-white/10 bg-[#1B1D21]' : 'border-gray-200 bg-white'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold text-gray-900 dark:text-slate-100">
              {step === 'ready' ? 'Application submitted' : 'Submit a consultant'}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-[#94A3B8]">{jobTitle}</p>
          </div>
          {!busy && (
            <button type="button" onClick={onClose} className={`rounded-full p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}>
              <X size={16} />
            </button>
          )}
        </div>

        {(step === 'form' || step === 'submitting') && (
          <>
            <div className="space-y-2.5">
              <div>
                <label className={labelClass}>Resume *</label>
                <label
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-[12px] transition-colors ${
                    isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-300 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Upload size={14} />
                  {resumeFile ? resumeFile.name : 'Click to choose a file'}
                  <input
                    type="file"
                    accept=".pdf,.docx,.rtf,.txt"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <div>
                <label className={labelClass}>Note (optional)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy}
                  rows={3}
                  placeholder="Anything you'd like to add for this submission…"
                  className={`${inputClass} resize-none`}
                />
              </div>
              <p className={`text-[11px] ${isDark ? 'text-[#64748B]' : 'text-gray-400'}`}>
                Candidate details are read from the resume automatically. Next, you'll get a screening link to start or share with the candidate.
              </p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50 ${isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                Cancel
              </button>
              <button type="button" onClick={() => void handleSubmit()} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {step === 'submitting' ? 'Submitting…' : 'Submit application'}
              </button>
            </div>
          </>
        )}

        {step === 'preparing' && (
          <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
            <RefreshCw size={22} className="animate-spin text-blue-500" />
            <p className="text-[12px] font-semibold text-gray-700 dark:text-slate-200">Preparing the AI screening…</p>
            <p className="text-[11px] text-gray-400 dark:text-[#64748B]">Generating the first question from the resume and this job post.</p>
          </div>
        )}

        {step === 'ready' && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10">
              <PartyPopper size={20} className="text-emerald-500" />
            </div>
            <p className="text-[12px] text-gray-500 dark:text-[#94A3B8]">
              The candidate's screening is ready. Start it now, or share the link so they can complete it on their own.
            </p>
            <div className="flex w-full flex-col gap-2">
              <a
                href={screeningUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700"
              >
                <Video size={14} />
                Start Screening
              </a>
              <button
                type="button"
                onClick={() => void handleShare()}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-[12px] font-semibold transition-colors ${isDark ? 'border-white/15 text-slate-200 hover:bg-white/5' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              >
                {justCopied ? <Check size={14} /> : <Copy size={14} />}
                {justCopied ? 'Link copied' : 'Share Screening Link'}
              </button>
            </div>
            <button type="button" onClick={onClose} className={`mt-1 text-[11px] font-semibold ${isDark ? 'text-[#94A3B8] hover:text-slate-200' : 'text-gray-500 hover:text-gray-700'}`}>
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-[12px] text-red-500">{errorMessage}</p>
            <div className="flex w-full gap-2">
              <button type="button" onClick={onClose} className={`flex-1 rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors ${isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                Close
              </button>
              {applicationId && (
                <button
                  type="button"
                  onClick={() => void runPrepareScreening(applicationId)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  <Send size={12} />
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
