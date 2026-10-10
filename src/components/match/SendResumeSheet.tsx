import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ExternalLink, FileText, Mail, Send, Sparkles, Upload, X } from 'lucide-react';
import LogoSpinner from '../LogoSpinner';
import { supabase } from '../../lib/supabase';
import { uploadProfileResume } from '../../lib/resumes';
import { leadOrg, type CardItem, type ResumeFile, type Subject } from '../../lib/today';
import { Initials } from './Visuals';
import type { Draft } from './MatchDetail';

// Resumes added here this session, per profile, and emails already written,
// per profile and job, so reopening doesn't upload or write again.
const added: Record<string, ResumeFile[]> = {};
const written: Record<string, Draft> = {};

// Send resume: pick one of the profile's resumes or drop in a new one, while
// AI writes the email to the poster. Edit anything, then Send.
export default function SendResumeSheet({ item, subject, name, accountId, gmailConnected, onConnectGmail, onClose, onSend, initialDraft }: {
  item: CardItem; subject: Subject | undefined; name: string; accountId: string | undefined; gmailConnected: boolean | null;
  onConnectGmail: () => void; onClose: () => void; onSend: (draft: Draft, resumeId: string) => void;
  /** An email already written (store screenshots); skips the AI. */
  initialDraft?: Draft;
}) {
  const lead = item.lead!;
  const key = `${item.subject_id}:${lead.id}`;
  const own = subject?.resumes ?? [];
  const [mine, setMine] = useState<ResumeFile[]>(() => [...(added[item.subject_id] ?? []).filter((r) => !own.some((o) => o.id === r.id)), ...own]);
  const [resumeId, setResumeId] = useState<string | null>(() => (mine.find((r) => r.is_default) ?? mine[0])?.id ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(initialDraft ?? written[key] ?? null);
  const [draftError, setDraftError] = useState('');
  const [drafting, setDrafting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const connected = gmailConnected !== false;

  const writeDraft = async () => {
    if (!accountId || drafting) return;
    setDrafting(true); setDraftError('');
    const { data, error } = await supabase.functions.invoke('submit-consultant', { body: { action: 'preview', account_id: accountId, subject_id: item.subject_id, job_id: lead.id } });
    setDrafting(false);
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const payload = ctx ? await ctx.json().catch(() => null) : null;
      setDraftError(payload?.message || payload?.error || 'Could not write the email.');
      return;
    }
    setDraft({ subject: data.subject, body: data.body, toName: data.to_name, duplicate: data.duplicate ?? null });
  };
  // The email is written while they choose the resume.
  useEffect(() => { if (connected && !draft) void writeDraft(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (draft) written[key] = draft; }, [draft, key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const upload = async (file: File) => {
    if (!accountId || uploading) return;
    setUploading(true); setUploadError('');
    try {
      const r = await uploadProfileResume(accountId, item.subject_id, file, mine.length === 0);
      added[item.subject_id] = [r, ...(added[item.subject_id] ?? [])];
      setMine((rs) => [r, ...rs]);
      setResumeId(r.id);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not add the resume.');
    } finally {
      setUploading(false);
    }
  };

  const duplicate = item.duplicate || draft?.duplicate || null;
  const ready = Boolean(draft && resumeId && !duplicate && !uploading);
  const field = 'w-full rounded-xl border border-gray-200 bg-white text-[14px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-[#1E2126]';
  const label = 'mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-gray-500 dark:text-slate-400';

  return createPortal(
    // Kept from the detail's swipe-to-next (React events cross the portal).
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`Send ${name}'s resume`}
      onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl animate-[ppSheetIn_.22s_ease-out] dark:bg-[#20242a] sm:max-w-[560px] sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10">
          <Initials name={name} id={item.subject_id} size={36} />
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[16px] font-extrabold">Send {name}&apos;s resume</b>
            <span className="block truncate text-[12.5px] text-gray-500 dark:text-slate-400">to {[draft?.toName || lead.poster, leadOrg(lead)].filter((v, i, all) => v && all.indexOf(v) === i).join(' · ')}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5"><X size={19} /></button>
        </div>

        {!connected ? (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-blue-600"><Mail size={22} /></span>
            <p className="max-w-[30ch] text-[14px] text-gray-600 dark:text-slate-300">Resumes go from your own Gmail. Connect it once.</p>
            <button type="button" onClick={onConnectGmail} className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-[14.5px] font-bold text-white hover:bg-blue-700"><Mail size={17} />Connect Gmail</button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <section>
                <p className={label}><FileText size={13} />Resume</p>
                <div className="space-y-2" role="radiogroup" aria-label="Resume to send">
                  {mine.map((r) => {
                    const on = r.id === resumeId;
                    const word = /\.docx?$/i.test(r.file_name);
                    return (
                      <div key={r.id} className={`flex items-center gap-1 rounded-xl border-[1.5px] pr-1 ${on ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-500/10' : 'border-gray-200 hover:border-gray-300 dark:border-white/10'}`}>
                        <button type="button" role="radio" aria-checked={on} onClick={() => setResumeId(r.id)} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left">
                          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${on ? 'bg-blue-600 text-white' : 'ring-[1.5px] ring-gray-300'}`}>{on && <Check size={12} strokeWidth={3.5} />}</span>
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[9.5px] font-extrabold ${word ? 'bg-blue-100 text-blue-700' : 'bg-red-50 text-red-600'}`}>{word ? 'DOC' : 'PDF'}</span>
                          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{r.file_name}</span>
                          {r.is_default && <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:bg-white/5">Default</span>}
                        </button>
                        <a href={r.url} target="_blank" rel="noreferrer" title="Open the resume" aria-label={`Open ${r.file_name}`}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5"><ExternalLink size={15} /></a>
                      </div>
                    );
                  })}
                  {/* A new resume: tap to pick, or drop it here. It joins the profile and is picked. */}
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); }}
                    className={`flex w-full items-center gap-3 rounded-xl border-[1.5px] border-dashed px-3 text-left transition-colors ${mine.length ? 'py-2.5' : 'py-5'} ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/40 dark:border-white/15'}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/15">{uploading ? <LogoSpinner size={16} /> : <Upload size={17} />}</span>
                    <span className="min-w-0">
                      <b className="block text-[14px] font-bold">{uploading ? 'Uploading…' : mine.length ? 'Upload a new resume' : `Add ${name}'s resume`}</b>
                      <span className="block text-[12px] text-gray-500 dark:text-slate-400">PDF or Word, up to 4 MB. Tap or drop it here.</span>
                    </span>
                  </button>
                  <input ref={fileInput} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
                  {uploadError && <p className="text-[12.5px] font-semibold text-red-600">{uploadError}</p>}
                </div>
              </section>

              <section>
                <p className={label}><Sparkles size={13} />Email<span className="ml-auto font-semibold">Written by AI · edit anything</span></p>
                {draft ? (
                  <div className="space-y-2">
                    {duplicate && <p className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-[12.5px] font-semibold text-amber-800">{duplicate}</p>}
                    <input aria-label="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className={`${field} h-10 px-3 font-semibold`} />
                    <textarea aria-label="Email" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={7} className={`${field} resize-y p-3 leading-relaxed`} />
                  </div>
                ) : draftError ? (
                  <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                    <p className="min-w-0 flex-1 text-[13px] text-red-700">{draftError}</p>
                    <button type="button" onClick={() => void writeDraft()} className="h-8 shrink-0 rounded-lg bg-white px-3 text-[13px] font-bold text-red-700 ring-1 ring-red-200">Try again</button>
                  </div>
                ) : (
                  // Written while they pick the resume.
                  <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-white/10" aria-busy="true">
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-gray-500"><LogoSpinner size={14} />Writing the email to {lead.poster || 'the poster'}…</p>
                    {[92, 100, 84, 64].map((w) => <i key={w} className="block h-2.5 animate-pulse rounded-full bg-gray-100 dark:bg-white/5" style={{ width: `${w}%` }} />)}
                  </div>
                )}
              </section>
            </div>

            <div className="border-t border-gray-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-white/10">
              <button type="button" disabled={!ready} onClick={() => { if (draft && resumeId) { onSend(draft, resumeId); onClose(); } }}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[15px] font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                {drafting ? <LogoSpinner size={15} /> : <Send size={17} />}
                {!resumeId ? 'Pick or upload a resume' : drafting ? 'Writing the email…' : 'Send resume'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
