import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';

// Lets a recruiter submit one of their bench consultants to a self-posted
// job they see in the Feed (cross-account by design — the job doesn't have
// to be one this account posted). Mirrors the resume-upload pattern already
// used in CandidateOnboarding.tsx (upload to the public `resumes` bucket,
// then reference the resulting URL), but writes go through
// submit_job_application rather than a direct insert, since social write
// tables in this app are RPC-only.
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
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [candidatePhone, setCandidatePhone] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inputClass = `w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none transition-colors focus:ring-2 ${
    isDark
      ? 'border-white/15 bg-[#171a1f] text-slate-100 placeholder:text-[#64748B] focus:border-blue-500 focus:ring-blue-500/20'
      : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:ring-blue-100'
  }`;
  const labelClass = `mb-1 block text-[11px] font-semibold ${isDark ? 'text-[#94A3B8]' : 'text-gray-600'}`;

  async function handleSubmit() {
    if (!candidateName.trim()) {
      showToast('Candidate name is required', 'error');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(candidateEmail.trim())) {
      showToast('A valid candidate email is required', 'error');
      return;
    }
    if (!resumeFile) {
      showToast('A resume upload is required', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const storagePath = `applications/${crypto.randomUUID()}-${resumeFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from('resumes')
        .upload(storagePath, resumeFile, { contentType: resumeFile.type || 'application/octet-stream' });
      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);

      const { error } = await supabase.rpc('submit_job_application' as never, {
        p_social_job_id: jobId,
        p_candidate_name: candidateName.trim(),
        p_candidate_email: candidateEmail.trim(),
        p_candidate_phone: candidatePhone.trim(),
        p_resume_url: urlData.publicUrl,
        p_resume_file_name: resumeFile.name,
      } as never);
      if (error) throw new Error(error.message);

      showToast('Application submitted', 'success');
      onSaved();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not submit application', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => !submitting && onClose()}>
      <div
        className={`w-full max-w-md rounded-lg border p-4 shadow-xl ${isDark ? 'border-white/10 bg-[#1B1D21]' : 'border-gray-200 bg-white'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold text-gray-900 dark:text-slate-100">Submit a consultant</h2>
            <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-[#94A3B8]">{jobTitle}</p>
          </div>
          <button type="button" onClick={onClose} className={`rounded-full p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2.5">
          <div>
            <label className={labelClass}>Candidate name *</label>
            <input className={inputClass} value={candidateName} onChange={(e) => setCandidateName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelClass}>Candidate email *</label>
              <input className={inputClass} type="email" value={candidateEmail} onChange={(e) => setCandidateEmail(e.target.value)} placeholder="jane@example.com" />
            </div>
            <div>
              <label className={labelClass}>Candidate phone</label>
              <input className={inputClass} value={candidatePhone} onChange={(e) => setCandidatePhone(e.target.value)} />
            </div>
          </div>
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
                accept=".pdf,.doc,.docx,.rtf,.txt"
                className="hidden"
                onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <p className={`text-[11px] ${isDark ? 'text-[#64748B]' : 'text-gray-400'}`}>
            The candidate will get an email with a short AI video screening to complete before you review their application.
          </p>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50 ${isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            Cancel
          </button>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        </div>
      </div>
    </div>
  );
}
