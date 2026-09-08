import { useState } from 'react';
import { PartyPopper, Upload, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';

// Lets a Bench Sales recruiter respond to a Vendor's resume request (a
// pulse_ask_ai_requests row with hotlist_id set) with an actual resume —
// the "Submission". Deliberately much simpler than SubmitApplicationModal
// (the Jobs-side equivalent): no AI resume parsing (nothing to extract —
// the consultant's details already live on the hotlist post itself) and
// no post-submit screening step (there's no screening concept for a
// hotlist resume reply).

type Step = 'form' | 'submitting' | 'done' | 'error';

export default function SubmitHotlistResumeModal({
  requestId,
  roleTitle,
  onClose,
  onSubmitted,
}: {
  requestId: string;
  roleTitle: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { isDark } = useTheme();
  const [step, setStep] = useState<Step>('form');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const inputClass = `w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none transition-colors focus:ring-2 ${
    isDark
      ? 'border-white/15 bg-[#171a1f] text-slate-100 placeholder:text-[#64748B] focus:border-blue-500 focus:ring-blue-500/20'
      : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:ring-blue-100'
  }`;
  const labelClass = `mb-1 block text-[11px] font-semibold ${isDark ? 'text-[#94A3B8]' : 'text-gray-600'}`;
  const busy = step === 'submitting';

  async function handleSubmit() {
    if (!resumeFile) {
      setErrorMessage('A resume upload is required');
      setStep('error');
      return;
    }

    setStep('submitting');
    try {
      const storagePath = `hotlist-submissions/${crypto.randomUUID()}-${resumeFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from('resumes')
        .upload(storagePath, resumeFile, { contentType: resumeFile.type || 'application/octet-stream' });
      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);

      const { error } = await supabase.rpc('submit_hotlist_resume' as never, {
        p_request_id: requestId,
        p_resume_url: urlData.publicUrl,
        p_resume_file_name: resumeFile.name,
        p_response_note: note.trim(),
      } as never);
      if (error) throw new Error(error.message);

      setStep('done');
      onSubmitted();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not submit the resume');
      setStep('error');
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div
        className={`w-full max-w-md rounded-lg border p-4 shadow-xl ${isDark ? 'border-white/10 bg-[#1B1D21]' : 'border-gray-200 bg-white'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold text-gray-900 dark:text-slate-100">
              {step === 'done' ? 'Resume sent' : 'Respond with a resume'}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-[#94A3B8]">{roleTitle}</p>
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
                  placeholder="Anything you'd like to add for this vendor…"
                  className={`${inputClass} resize-none`}
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50 ${isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                Cancel
              </button>
              <button type="button" onClick={() => void handleSubmit()} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {step === 'submitting' ? 'Sending…' : 'Send resume'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10">
              <PartyPopper size={20} className="text-emerald-500" />
            </div>
            <p className="text-[12px] text-gray-500 dark:text-[#94A3B8]">The resume was sent to the vendor.</p>
            <button type="button" onClick={onClose} className="w-full rounded-md bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700">
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-[12px] text-red-500">{errorMessage}</p>
            <button type="button" onClick={() => setStep('form')} className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/15 dark:text-[#94A3B8] dark:hover:bg-white/5">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
