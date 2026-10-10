import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ChevronLeft, Copy, ExternalLink, FileText, Mail, Paperclip, RefreshCw, Send, Target, Upload, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import LeadCard, { hideEmails, loadLeadsByIds, openLeadPostContent, OutOfCreditsError, type LeadCardProps, type SocialLead } from '../components/LeadCard';
import ApplyOnSiteButton from '../components/ApplyOnSite';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { consultantTitle } from '../lib/consultant-title';
import { trackEvent } from '../lib/track';

// Today: column 1 the day's count and the consultants, column 2 the selected
// consultant's matches, column 3 the submission (email) or the application
// (filled details + the firm's page) for the selected match.

type QueueItem = {
  card_id: string; job_id: string; title: string | null; poster: string | null; company: string | null;
  location: string | null; pay: string | null; source: string; apply_url: string | null; posted_at: string;
  similarity: number; fit?: number; has_email: boolean; duplicate: string | null;
};
type QueueSubject = {
  subject_id: string; role_title: string | null; candidate_name: string | null; visa_type: string | null;
  location: string | null; years_experience: number | null; skills: string[] | null; resume_url: string | null;
  resume_file_name: string | null; submitted_today: number; waiting: number; locked?: number; items: QueueItem[];
  resumes?: ResumeFile[];
};
type ResumeFile = { id: string; url: string; file_name: string; is_default: boolean };
type Queue = { target: number; daily_cap: number; used_today: number; submitted_today: number; subjects: QueueSubject[] };
type Draft = { jobId: string; toName: string; subject: string; body: string; duplicate: string | null };
type ItemState = 'sending' | 'sent' | 'skipped' | { error: string };

const PACE_MS = 4000;
const noop = () => {};

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('submit-consultant', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx ? await ctx.json().catch(() => null) : null;
    return { ok: false as const, code: payload?.error as string | undefined, message: (payload?.message || payload?.error || error.message) as string };
  }
  return { ok: true as const, data };
}

// The post as a recruiter needs to read it: addresses hidden (Send is the way
// to reach them) and the trailing #hashtag blocks removed.
function cleanDescription(raw: string) {
  let text = hideEmails(raw).split('[email hidden · use AI Submit]').join('[email hidden]');
  // Repeated until stable: tags are often glued together ("#Ajobs;#ITJobs").
  for (let prev = ''; prev !== text;) {
    prev = text;
    text = text.replace(/(^|[\s(;,])#[\p{L}\p{N}_][\p{L}\p{N}_&.-]*;?/gu, '$1');
  }
  return text
    .split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .filter((line, i, all) => line.trim() !== '' || (i > 0 && all[i - 1].trim() !== ''))
    .join('\n')
    .trim();
}

function CopyRow({ label, value }: { label: string; value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 border-b border-gray-100 py-1.5 last:border-0 dark:border-white/5">
      <span className="w-24 shrink-0 text-[11px] text-gray-400">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-800 dark:text-slate-200">{value}</span>
      <button
        type="button"
        onClick={() => { void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}
        className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5"
        title="Copy"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

export default function TodayPage() {
  const { account, user, refreshAccount } = useAuth();
  const { isDark } = useTheme();
  const accountId = account?.id;
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [subjectLeads, setSubjectLeads] = useState<Record<string, SocialLead>>({});
  const [jobLeads, setJobLeads] = useState<Record<string, SocialLead>>({});
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  // Phones show one column at a time: consultants, then their matches, then
  // the submission. Desktop shows all three side by side.
  const [mobileStep, setMobileStep] = useState<'subjects' | 'matches' | 'submit'>('subjects');
  const [itemState, setItemState] = useState<Record<string, ItemState>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [frame, setFrame] = useState<{ jobId: string; embeddable: boolean } | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [resumes, setResumes] = useState<Record<string, { url: string; name: string }>>({});
  // Every resume on file per consultant, and the one picked for the next send.
  const [resumeFiles, setResumeFiles] = useState<Record<string, ResumeFile[]>>({});
  const [chosenResume, setChosenResume] = useState<Record<string, string>>({});
  const [uploadingFor, setUploadingFor] = useState('');
  // The account's minimum match % for new matches: 70 on free accounts, 50-80
  // of their choosing on paid ones.
  const [minMatch, setMinMatch] = useState(70);
  const [paidPlan, setPaidPlan] = useState(false);
  useEffect(() => {
    if (!accountId) return;
    void supabase.rpc('get_match_caps' as never).then(({ data }: { data: { paid?: boolean } | null }) => setPaidPlan(Boolean(data?.paid)));
    void supabase.from('accounts').select('match_min_score' as never).eq('id', accountId).maybeSingle()
      .then(({ data }: { data: { match_min_score?: number } | null }) => { if (data?.match_min_score) setMinMatch(data.match_min_score); });
  }, [accountId]);
  const changeMinMatch = async (value: number) => {
    if (!paidPlan) return;
    setMinMatch(value);
    trackEvent('min_match_changed', { value, from: 'today' });
    await supabase.rpc('set_match_min_score' as never, { p_score: value } as never);
  };

  const [description, setDescription] = useState<{ jobId: string; text: string; outOfCredits?: boolean } | null>(null);
  const stopBulk = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_submission_queue' as never, { p_per_subject: 40 } as never);
    if (rpcError) { setError(rpcError.message); setLoading(false); return; }
    const q = data as unknown as Queue | null;
    setQueue(q);
    if (q) {
      setResumes(Object.fromEntries(q.subjects.filter((s) => s.resume_url).map((s) => [s.subject_id, { url: s.resume_url!, name: s.resume_file_name || 'Resume' }])));
      setResumeFiles(Object.fromEntries(q.subjects.map((s) => [s.subject_id, s.resumes ?? []])));
      setChosenResume((prev) => {
        const next = { ...prev };
        for (const s of q.subjects) {
          const files = s.resumes ?? [];
          if (!files.some((f) => f.id === next[s.subject_id])) {
            const def = files.find((f) => f.is_default) ?? files[0];
            if (def) next[s.subject_id] = def.id; else delete next[s.subject_id];
          }
        }
        return next;
      });
      const [subs, jobs] = await Promise.all([
        loadLeadsByIds('hotlist', q.subjects.map((s) => s.subject_id)),
        loadLeadsByIds('job', [...new Set(q.subjects.flatMap((s) => s.items.map((i) => i.job_id)))]),
      ]);
      setSubjectLeads(subs);
      setJobLeads(jobs);
      setSelectedSubject((cur) => cur && q.subjects.some((s) => s.subject_id === cur)
        ? cur
        : (q.subjects.find((s) => s.items.length > 0) ?? q.subjects[0])?.subject_id ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void supabase.from('gmail_integration_status' as never).select('status').maybeSingle()
      .then(({ data }: { data: { status?: string } | null }) => setGmailConnected(data?.status === 'connected'));
  }, []);

  const subject = queue?.subjects.find((s) => s.subject_id === selectedSubject) ?? null;
  const items = useMemo(() => subject?.items ?? [], [subject]);
  const item = items.find((i) => i.job_id === selectedJob) ?? null;
  const capLeft = queue ? Math.max(0, queue.daily_cap - queue.used_today) : 0;

  // Selecting a consultant opens their first match that still needs action.
  useEffect(() => {
    if (!subject) { setSelectedJob(null); return; }
    setSelectedJob((cur) => (cur && subject.items.some((i) => i.job_id === cur) ? cur
      : subject.items.find((i) => !itemState[i.card_id] && !i.duplicate)?.job_id ?? subject.items[0]?.job_id ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubject, subject?.items.length]);

  useEffect(() => { setChecked(new Set()); }, [selectedSubject]);

  // Column 3, top half: the full post. 1 credit the first time this account
  // opens the job, as everywhere else.
  useEffect(() => {
    if (!selectedJob) { setDescription(null); return; }
    let alive = true;
    openLeadPostContent(selectedJob, 'job')
      .then(({ content, charged }) => {
        if (charged) void refreshAccount();
        // Addresses stay hidden, as everywhere else: Send is the way to reach them.
        if (alive) setDescription({ jobId: selectedJob, text: cleanDescription(content === 'No post content available.' ? '' : content) });
      })
      .catch((e) => {
        if (alive) setDescription({ jobId: selectedJob, text: '', outOfCredits: e instanceof OutOfCreditsError });
      });
    return () => { alive = false; };
  }, [selectedJob, refreshAccount]);

  // Column 3, bottom half: the email draft, or whether the firm's page can be
  // shown here.
  useEffect(() => {
    setDraft(null);
    setFrame(null);
    if (!item || !subject || !accountId) return;
    if (item.source === 'career_site') {
      void invoke({ action: 'frame_check', job_id: item.job_id }).then((r) => {
        setFrame({ jobId: item.job_id, embeddable: Boolean(r.ok && r.data?.embeddable) });
      });
      return;
    }
    if (!item.has_email) return;
    setDraftLoading(true);
    void invoke({ action: 'preview', account_id: accountId, subject_id: subject.subject_id, job_id: item.job_id }).then((r) => {
      setDraftLoading(false);
      if (r.ok) setDraft({ jobId: item.job_id, toName: r.data.to_name, subject: r.data.subject, body: r.data.body, duplicate: r.data.duplicate });
      else setError(r.message);
    });
  }, [item?.job_id, subject?.subject_id, accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectGmail = async () => {
    if (!accountId) return;
    setConnecting(true);
    const { data, error: e } = await supabase.functions.invoke('gmail-oauth-start', { body: { account_id: accountId, return_to: '/today', return_origin: window.location.origin } });
    if (e || !data?.url) { setError(data?.error || 'Could not start Gmail connection'); setConnecting(false); return; }
    window.location.href = data.url;
  };

  const nextAfter = (jobId: string) => {
    const idx = items.findIndex((i) => i.job_id === jobId);
    return items.slice(idx + 1).find((i) => !itemState[i.card_id] && !i.duplicate)?.job_id ?? null;
  };

  const bumpCounts = (subjectId: string) => setQueue((q) => q && {
    ...q, submitted_today: q.submitted_today + 1, used_today: q.used_today + 1,
    subjects: q.subjects.map((s) => (s.subject_id === subjectId ? { ...s, submitted_today: s.submitted_today + 1 } : s)),
  });

  // Returns false when sending should stop (limit, credits, Gmail).
  const send = async (s: QueueSubject, i: QueueItem, edited?: { subject: string; body: string }) => {
    if (!accountId) return false;
    setItemState((m) => ({ ...m, [i.card_id]: 'sending' }));
    const resumeId = chosenResume[s.subject_id];
    const r = await invoke({ action: 'send', account_id: accountId, subject_id: s.subject_id, job_id: i.job_id, request_id: crypto.randomUUID(), ...(resumeId ? { resume_id: resumeId } : {}), ...edited });
    if (!r.ok) {
      setItemState((m) => ({ ...m, [i.card_id]: { error: r.message } }));
      if (r.code === 'daily_limit_reached') setError(`Daily send limit reached (${queue?.daily_cap}). Buy credits to raise it to 100 a day.`);
      else if (r.code === 'insufficient_credits') setError('Out of credits. Buy credits to keep sending.');
      else if (r.code === 'gmail_not_connected') { setGmailConnected(false); setError('Connect Gmail to send submissions.'); }
      return !['daily_limit_reached', 'insufficient_credits', 'gmail_not_connected'].includes(r.code ?? '');
    }
    setItemState((m) => ({ ...m, [i.card_id]: 'sent' }));
    bumpCounts(s.subject_id);
    return true;
  };

  const sendSelected = async () => {
    if (!subject || !item || !draft) return;
    const next = nextAfter(item.job_id);
    const ok = await send(subject, item, { subject: draft.subject, body: draft.body });
    if (ok && next) setSelectedJob(next);
  };

  async function uploadResume(subjectId: string, file: File) {
    if (!accountId) return;
    if (!/\.(pdf|docx?)$/i.test(file.name)) { setError('Attach a PDF or Word resume.'); return; }
    if (file.size > 4 * 1024 * 1024) { setError('Resume must be under 4 MB.'); return; }
    setUploadingFor(subjectId);
    try {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
      const storagePath = `consultant-resumes/${accountId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('resumes').upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
      if (uploadError) throw new Error(uploadError.message);
      const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);
      const { data: newId, error: rpcError } = await supabase.rpc('set_hotlist_resume' as never, { p_hotlist_id: subjectId, p_url: urlData.publicUrl, p_file_name: file.name } as never);
      if (rpcError) throw new Error(rpcError.message);
      // Uploading adds a resume; the first one is the default.
      const isFirst = !(resumeFiles[subjectId]?.length);
      const added: ResumeFile = { id: String(newId), url: urlData.publicUrl, file_name: file.name, is_default: isFirst };
      setResumeFiles((prev) => ({ ...prev, [subjectId]: [added, ...(prev[subjectId] ?? [])] }));
      setChosenResume((prev) => ({ ...prev, [subjectId]: added.id }));
      if (isFirst) setResumes((prev) => ({ ...prev, [subjectId]: { url: urlData.publicUrl, name: file.name } }));
      trackEvent('consultant_resume_attached', { type: file.name.split('.').pop()?.toLowerCase() ?? '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach the resume.');
    } finally {
      setUploadingFor('');
    }
  }

  // Skip: not a match. It leaves the list (and the Tracker) for good.
  const skip = async () => {
    if (!item || !subject) return;
    const next = nextAfter(item.job_id);
    const cardId = item.card_id;
    setQueue((q) => q && { ...q, subjects: q.subjects.map((s) => (s.subject_id === subject.subject_id
      ? { ...s, waiting: Math.max(0, s.waiting - 1), items: s.items.filter((i) => i.card_id !== cardId) } : s)) });
    setChecked((c) => { const n = new Set(c); n.delete(cardId); return n; });
    setSelectedJob(next);
    await supabase.rpc('move_pipeline_card' as never, { p_id: cardId, p_stage: 'closed', p_reason: 'not_a_match' } as never);
  };

  const sendable = (i: QueueItem) => i.has_email && !i.duplicate && i.source !== 'career_site' && !itemState[i.card_id];

  const sendTop = async () => {
    if (!subject) return;
    const pool = checked.size > 0 ? items.filter((i) => checked.has(i.card_id)) : items;
    const targets = pool.filter(sendable).slice(0, checked.size > 0 ? capLeft : Math.min(10, capLeft));
    if (targets.length === 0) return;
    stopBulk.current = false;
    setBulk({ done: 0, total: targets.length });
    for (let k = 0; k < targets.length; k++) {
      if (stopBulk.current) break;
      const keepGoing = await send(subject, targets[k]);
      setBulk({ done: k + 1, total: targets.length });
      if (!keepGoing) break;
      // Paced so the user's own mailbox isn't flagged for bursts.
      if (k < targets.length - 1) await new Promise((res) => setTimeout(res, PACE_MS + Math.random() * 1500));
    }
    setBulk(null);
    setChecked(new Set());
  };

  const cardProps = (lead: SocialLead, idx: number, selected: boolean, onSelect: () => void): LeadCardProps => ({
    lead, accountId, userId: user?.id, paletteIndex: idx, isDark, isHotlistFeed: lead.kind === 'hotlist', feedTimeBasis: 'posted',
    isLeadRevealed: false, globalAskedJobState: undefined, predictResult: undefined, askedRequestedAt: undefined, askedFulfilledAt: undefined,
    revealedAt: undefined, isInlineBreakdownExpanded: false, isSkillsExpanded: false, isExpFieldExpanded: false,
    isWorkTypeFieldExpanded: false, isEmpTypeFieldExpanded: false, isRateFieldExpanded: false, isVisaFieldExpanded: false,
    isLocationFieldExpanded: false, isLoadingPreview: false, isProcessingAskAI: false, onPreview: noop, onAskAI: noop,
    onToggleInlineBreakdown: noop, onExpandSkills: noop, onCollapseSkills: noop, onToggleField: noop,
    hideActions: true, isSelected: selected, onSelect: () => onSelect(),
  });

  const stateOf = (i: QueueItem) => itemState[i.card_id];
  const panel = 'flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-[#20242a]';

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f3f2ee] pb-[calc(4.25rem+env(safe-area-inset-bottom))] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100 sm:pb-0">
      <AppNav />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-2 sm:p-3 lg:grid-cols-[minmax(0,300px)_minmax(0,400px)_minmax(0,1fr)]">

        {/* Column 1: the day and the consultants */}
        <div className={`${mobileStep === 'subjects' ? 'flex' : 'hidden'} min-h-0 flex-col gap-2 lg:flex`}>
          <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-[#20242a]">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10"><Target size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-gray-500">Today's submissions</p>
                <p className="text-xl font-bold tabular-nums leading-tight">{queue?.submitted_today ?? 0}</p>
              </div>
              <button onClick={() => void load()} disabled={loading} title="Refresh" className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              {capLeft} sends left today
              {queue && queue.daily_cap < 100 && <> · trial limit 10, <Link to="/billing" className="font-semibold text-blue-600">buy matches</Link> for 100/day</>}
            </p>
            {/* Matches are the one thing credits pay for: what's left, and the
                minimum match % new ones must reach. */}
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2 text-[12px] dark:border-white/10">
              <Link to="/billing" className="text-gray-600 hover:text-blue-600 dark:text-slate-300">
                <b className="tabular-nums text-gray-900 dark:text-white">{Math.floor(Number(account?.credits_balance ?? 0)).toLocaleString('en-IN')}</b> matches left
              </Link>
              <Link to="/settings/matching" className="text-gray-400 hover:text-blue-600" title="Matching settings">Settings</Link>
              {paidPlan ? (
                <label className="inline-flex items-center gap-1 text-gray-500">
                  Min match
                  <select
                    value={minMatch}
                    onChange={(e) => void changeMinMatch(Number(e.target.value))}
                    className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[12px] font-semibold text-gray-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
                    title="New matches must reach this match %"
                  >
                    {[50, 55, 60, 65, 70, 75, 80].map((v) => <option key={v} value={v}>{v}%</option>)}
                  </select>
                </label>
              ) : (
                <Link to="/billing" className="text-gray-500 hover:text-blue-600" title="Paid accounts choose 50-80%">
                  Min match 70% · <span className="font-semibold text-blue-600">choose on paid</span>
                </Link>
              )}
            </div>
            {gmailConnected === false ? (
              <button onClick={() => void connectGmail()} disabled={connecting} className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-amber-600 text-[12px] font-semibold text-white hover:bg-amber-700 disabled:opacity-60">
                <Mail size={13} />{connecting ? 'Opening Google…' : 'Connect Gmail to send'}
              </button>
            ) : gmailConnected && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-emerald-600"><Check size={12} />Gmail connected</p>
            )}
            {error && (
              <div className="mt-2 flex items-start justify-between gap-2 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
                <span>{error}</span><button onClick={() => setError('')}><X size={12} /></button>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pl-2.5 pr-1 pt-3">
            {loading && !queue && <div className="flex justify-center py-10"><LogoSpinner size={20} /></div>}
            {queue && queue.subjects.length === 0 && (
              <p className="rounded-lg bg-white p-4 text-center text-[12px] text-gray-500 dark:bg-[#20242a]">
                Post your consultants (hotlist) to get matched requirements here every day. <Link to="/tracker" className="font-semibold text-blue-600">Tracker</Link>
              </p>
            )}
            {queue?.subjects.map((s, idx) => {
              const lead = subjectLeads[s.subject_id];
              const resume = resumes[s.subject_id];
              return (
                <div key={s.subject_id} className="relative">
                  {/* Matches waiting on this consultant, as a notification count. */}
                  {s.waiting > 0 && (
                    <span className="pointer-events-none absolute -left-2 -top-2 z-20 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-[12px] font-bold tabular-nums text-white shadow ring-2 ring-[#f3f2ee] dark:ring-[#1B1D21]">
                      {s.waiting > 99 ? '99+' : s.waiting}
                    </span>
                  )}
                  {lead ? (
                    <LeadCard {...cardProps(lead, idx, s.subject_id === selectedSubject, () => { setSelectedSubject(s.subject_id); setMobileStep('matches'); })} />
                  ) : (
                    <button onClick={() => { setSelectedSubject(s.subject_id); setMobileStep('matches'); }} className={`w-full rounded-lg border bg-white px-3 py-2 text-left text-[13px] font-semibold dark:bg-[#20242a] ${s.subject_id === selectedSubject ? 'border-blue-500' : 'border-gray-200 dark:border-white/10'}`}>
                      {consultantTitle(s.role_title)}
                    </button>
                  )}
                  {(s.locked ?? 0) > 0 && (
                    <Link to="/billing" className="mx-1.5 mt-1.5 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-[12px] font-semibold text-amber-800 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300">
                      <span>{s.locked} new {s.locked === 1 ? 'match' : 'matches'} waiting</span>
                      <span className="text-amber-700 underline underline-offset-2 dark:text-amber-200">Top up</span>
                    </Link>
                  )}
                  <div className="flex items-center gap-2 px-1.5 pt-1.5 text-[12px] text-gray-500">
                    <span>{s.submitted_today} sent today</span>
                    <span className="ml-auto inline-flex items-center gap-1">
                      {resume ? (
                        <a href={resume.url} target="_blank" rel="noreferrer" title={(resumeFiles[s.subject_id]?.length ?? 0) > 1 ? `${resumeFiles[s.subject_id].length} resumes · default: ${resume.name}` : `Resume: ${resume.name}`} aria-label="Open resume"
                          className="flex h-6 w-6 items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10">
                          <Paperclip size={13} />
                        </a>
                      ) : (
                        <span title="No resume on file" className="flex h-6 w-6 items-center justify-center text-amber-500"><AlertTriangle size={12} /></span>
                      )}
                      <label title={resume ? 'Add another resume' : 'Upload resume'} aria-label={resume ? 'Add another resume' : 'Upload resume'}
                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10">
                        {uploadingFor === s.subject_id ? <LogoSpinner size={11} /> : <Upload size={13} />}
                        <input type="file" accept=".pdf,.doc,.docx" className="hidden" disabled={Boolean(uploadingFor)}
                          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadResume(s.subject_id, f); }} />
                      </label>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: the selected consultant's matches */}
        <div className={`${panel} ${mobileStep === 'matches' ? '' : 'max-lg:hidden'}`}>
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-white/10">
            <button type="button" onClick={() => setMobileStep('subjects')} aria-label="Back to consultants"
              className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 lg:hidden">
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{subject ? consultantTitle(subject.role_title) : 'Matches'}</p>
              <p className="text-[11px] text-gray-500">
                {items.length} fresh matches ·{' '}
                <button type="button" className="font-semibold text-blue-600 hover:underline"
                  onClick={() => setChecked(checked.size > 0 ? new Set() : new Set(items.filter(sendable).map((i) => i.card_id)))}>
                  {checked.size > 0 ? `Clear (${checked.size})` : 'Select all'}
                </button>
              </p>
            </div>
            {bulk ? (
              <button onClick={() => { stopBulk.current = true; }} className="h-8 shrink-0 rounded-md border border-gray-300 px-3 text-[12px] font-semibold">Stop ({bulk.done}/{bulk.total})</button>
            ) : (
              <button
                onClick={() => void sendTop()}
                disabled={!subject || capLeft === 0 || gmailConnected === false || !(checked.size > 0 ? items.some((i) => checked.has(i.card_id) && sendable(i)) : items.some(sendable))}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                <Send size={12} />{checked.size > 0 ? `Send selected (${items.filter((i) => checked.has(i.card_id) && sendable(i)).length})` : 'Send top 10'}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            {subject && items.length === 0 && <p className="py-10 text-center text-[12px] text-gray-400">No fresh matches. New requirements are matched every 10 minutes.</p>}
            {items.map((i, idx) => {
              const lead = jobLeads[i.job_id];
              const st = stateOf(i);
              return (
                <div key={i.card_id} className={st === 'sent' || st === 'skipped' ? 'opacity-50' : ''}>
                  {lead && (
                    <LeadCard
                      {...cardProps(lead, idx, i.job_id === selectedJob, () => { setSelectedJob(i.job_id); setMobileStep('submit'); })}
                      bulkSelectable={sendable(i) || checked.has(i.card_id)}
                      isBulkSelected={checked.has(i.card_id)}
                      onToggleBulkSelect={() => setChecked((c) => { const n = new Set(c); if (n.has(i.card_id)) n.delete(i.card_id); else n.add(i.card_id); return n; })}
                    />
                  )}
                  <div className="flex items-center gap-2 px-1.5 pt-1.5 text-[12px]">
                    <span className="text-gray-400">{i.fit ?? Math.round(i.similarity * 100)}% match</span>
                    {st === 'sent' && <span className="font-semibold text-emerald-600">Sent</span>}
                    {st === 'skipped' && <span className="text-gray-400">Skipped</span>}
                    {st === 'sending' && <span className="text-blue-600">Sending…</span>}
                    {typeof st === 'object' && <span className="truncate text-red-600">{st.error}</span>}
                    {i.duplicate && <span className="truncate text-amber-600">{i.duplicate}</span>}
                    {!i.has_email && i.source !== 'career_site' && <span className="text-gray-400">no email</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 3: the full post on top; the email (or the application) below;
            Skip and Send (or Apply) at the bottom. */}
        <aside className={`${panel} ${mobileStep === 'submit' ? '' : 'max-lg:hidden'}`}>
          {!item || !subject ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-gray-400">
              Select a match to submit
              <button type="button" onClick={() => setMobileStep('matches')} className="font-semibold text-blue-600 lg:hidden">Back to matches</button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 border-b border-gray-100 px-4 py-2.5 dark:border-white/10 max-lg:pl-2">
                <button type="button" onClick={() => setMobileStep('matches')} aria-label="Back to matches"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 lg:hidden">
                  <ChevronLeft size={18} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{item.title}</p>
                  <p className="truncate text-[12px] text-gray-500">{[item.poster || item.company, item.location, item.pay].filter(Boolean).join(' · ')}</p>
                </div>
              </div>

              {/* Top half */}
              <div className="min-h-0 flex-1 basis-1/2 overflow-y-auto border-b border-gray-100 dark:border-white/10">
                {item.source === 'career_site' && frame?.jobId === item.job_id && frame.embeddable && item.apply_url ? (
                  <iframe title="Job application" src={item.apply_url} className="h-full min-h-[260px] w-full border-0" sandbox="allow-forms allow-scripts allow-same-origin allow-popups" />
                ) : description?.jobId !== item.job_id ? (
                  <div className="flex h-full items-center justify-center py-8"><LogoSpinner size={16} /></div>
                ) : (
                  <div className="px-4 py-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Job description</p>
                    {description.outOfCredits ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[12.5px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                        <p className="font-semibold">You&apos;re out of credits</p>
                        <p className="mt-0.5">Opening a job&apos;s full post costs 1 credit the first time.</p>
                        <Link to="/billing" className="mt-2 inline-flex h-8 items-center rounded-md bg-amber-600 px-3 text-[12px] font-semibold text-white hover:bg-amber-700">Buy credits</Link>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-gray-700 dark:text-slate-300">{description.text || 'No description in this post.'}</p>
                    )}
                    {item.source === 'career_site' && item.apply_url && frame?.jobId === item.job_id && !frame.embeddable && (
                      <a href={item.apply_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-[12px] font-semibold hover:bg-gray-50 dark:border-white/10">
                        <ExternalLink size={12} />Open on {item.poster || 'the firm'}'s site
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom half: the submission, on a light yellow. */}
              <div className="flex min-h-0 flex-1 basis-1/2 flex-col overflow-y-auto bg-amber-50 px-4 py-3 dark:bg-amber-500/10">
                {item.source === 'career_site' ? (
                  <>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Application details</p>
                    <CopyRow label="Name" value={subject.candidate_name} />
                    <CopyRow label="Role" value={consultantTitle(subject.role_title)} />
                    <CopyRow label="Experience" value={subject.years_experience ? `${Math.round(subject.years_experience)} years` : null} />
                    <CopyRow label="Skills" value={(subject.skills ?? []).join(', ')} />
                    <CopyRow label="Work auth" value={subject.visa_type} />
                    <CopyRow label="Location" value={subject.location} />
                    {resumes[subject.subject_id]
                      ? <a href={resumes[subject.subject_id].url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600"><FileText size={12} />{resumes[subject.subject_id].name}</a>
                      : <p className="mt-1 text-[11px] text-amber-600">No resume on file. Upload one on the consultant's card.</p>}
                  </>
                ) : !item.has_email ? (
                  <p className="m-auto text-[12px] text-gray-400">This post has no email to submit to.</p>
                ) : draftLoading || draft?.jobId !== item.job_id ? (
                  <div className="m-auto"><LogoSpinner size={16} /></div>
                ) : (
                  <>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Submission email</p>
                    <p className="mb-1.5 text-[11px] text-gray-500">
                      To {draft.toName} · from your Gmail · {(resumeFiles[subject.subject_id]?.length ?? 0) > 1 ? (
                        <select
                          value={chosenResume[subject.subject_id] ?? ''}
                          onChange={(e) => setChosenResume((prev) => ({ ...prev, [subject.subject_id]: e.target.value }))}
                          aria-label="Resume to attach"
                          className="max-w-[220px] rounded border border-amber-200 bg-white px-1 py-0.5 text-[11px] font-semibold text-gray-800 dark:border-amber-400/20 dark:bg-[#1E2126] dark:text-slate-100"
                        >
                          {resumeFiles[subject.subject_id].map((f) => <option key={f.id} value={f.id}>{f.file_name}{f.is_default ? ' (default)' : ''}</option>)}
                        </select>
                      ) : resumes[subject.subject_id] ? `${resumes[subject.subject_id].name}` : 'no resume on file'}{resumes[subject.subject_id] ? ' attached' : ''} · free
                    </p>
                    {(item.duplicate || draft.duplicate) && <p className="mb-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">{item.duplicate || draft.duplicate}</p>}
                    <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className="mb-1.5 h-8 w-full shrink-0 rounded-md border border-amber-200 bg-white px-2.5 text-[13px] outline-none focus:border-amber-400 dark:border-amber-400/20 dark:bg-[#1E2126]" />
                    <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="min-h-[140px] w-full flex-1 resize-none rounded-md border border-amber-200 bg-white p-2.5 text-[13px] leading-relaxed outline-none focus:border-amber-400 dark:border-amber-400/20 dark:bg-[#1E2126]" />
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-2 border-t border-gray-100 px-4 py-2.5 dark:border-white/10">
                <button onClick={() => void skip()} disabled={stateOf(item) === 'sending' || stateOf(item) === 'sent'} className="h-9 flex-1 rounded-md border border-gray-300 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-white/10 dark:text-slate-200">
                  Skip
                </button>
                {item.source === 'career_site' ? (
                  <div className="flex flex-1">
                    <ApplyOnSiteButton
                      lead={{ id: item.job_id, postSource: 'career_site', kind: 'job', applyUrl: item.apply_url, posterName: item.poster ?? '' }}
                      variant="panel"
                      subjectId={subject.subject_id}
                      onApplied={() => { setItemState((m) => ({ ...m, [item.card_id]: 'sent' })); bumpCounts(subject.subject_id); }}
                    />
                  </div>
                ) : stateOf(item) === 'sent' ? (
                  <span className="inline-flex h-9 flex-1 items-center justify-center gap-1 text-[13px] font-semibold text-emerald-600"><Check size={14} />Sent</span>
                ) : (
                  <button
                    onClick={() => void sendSelected()}
                    disabled={!draft || draft.jobId !== item.job_id || Boolean(item.duplicate || draft?.duplicate) || stateOf(item) === 'sending' || gmailConnected === false || capLeft === 0 || !item.has_email}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    {stateOf(item) === 'sending' ? <LogoSpinner size={13} /> : <Send size={13} />}Send
                  </button>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
