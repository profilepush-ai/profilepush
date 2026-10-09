import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ChevronDown, ChevronRight, FileText, Mail, RefreshCw, Send, Target, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import ApplyOnSiteButton from '../components/ApplyOnSite';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { consultantTitle } from '../lib/consultant-title';

type QueueItem = {
  card_id: string;
  job_id: string;
  title: string | null;
  poster: string | null;
  company: string | null;
  location: string | null;
  pay: string | null;
  rate_min: number | null;
  rate_max: number | null;
  source: string;
  apply_url: string | null;
  posted_at: string;
  similarity: number;
  has_email: boolean;
  duplicate: string | null;
};

type QueueSubject = {
  subject_id: string;
  role_title: string | null;
  candidate_name: string | null;
  visa_type: string | null;
  location: string | null;
  years_experience: number | null;
  skills: string[] | null;
  resume_url: string | null;
  resume_file_name: string | null;
  submitted_today: number;
  waiting: number;
  items: QueueItem[];
};

type Queue = { target: number; daily_cap: number; used_today: number; submitted_today: number; subjects: QueueSubject[] };

type Draft = { subjectId: string; item: QueueItem; subject: string; body: string; to: string; duplicate: string | null };

const PACE_MS = 4000;

function ago(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function payOf(i: QueueItem) {
  if (i.pay) return i.pay;
  if (i.rate_min || i.rate_max) {
    const lo = i.rate_min ?? i.rate_max;
    const hi = i.rate_max ?? i.rate_min;
    return lo === hi ? `$${lo}/hr` : `$${lo}–${hi}/hr`;
  }
  return '';
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('submit-consultant', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx ? await ctx.json().catch(() => null) : null;
    return { ok: false as const, code: payload?.error as string | undefined, message: (payload?.message || payload?.error || error.message) as string };
  }
  return { ok: true as const, data };
}

export default function TodayPage() {
  const { account } = useAuth();
  const accountId = account?.id;
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, 'sending' | 'sent' | 'skipped' | string>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [bulk, setBulk] = useState<{ subjectId: string; done: number; total: number } | null>(null);
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const stopBulk = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_submission_queue' as never, { p_per_subject: 25 } as never);
    if (rpcError) setError(rpcError.message);
    else {
      const q = data as unknown as Queue | null;
      setQueue(q);
      setOpen((prev) => {
        if (Object.keys(prev).length > 0 || !q) return prev;
        const first = q.subjects.find((s) => s.items.length > 0);
        return first ? { [first.subject_id]: true } : prev;
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void supabase.from('gmail_integration_status' as never).select('status').maybeSingle()
      .then(({ data }: { data: { status?: string } | null }) => setGmailConnected(data?.status === 'connected'));
  }, []);

  const connectGmail = async () => {
    if (!accountId) return;
    setConnecting(true);
    const { data, error: e } = await supabase.functions.invoke('gmail-oauth-start', { body: { account_id: accountId, return_to: '/today' } });
    if (e || !data?.url) { setError(data?.error || 'Could not start Gmail connection'); setConnecting(false); return; }
    window.location.href = data.url;
  };

  const markItem = (cardId: string, state: string) => setBusy((b) => ({ ...b, [cardId]: state }));

  const handleFailure = (cardId: string, code: string | undefined, message: string) => {
    if (code === 'daily_limit_reached') setError(`Daily send limit reached (${queue?.daily_cap ?? ''}). Buy credits to raise it to 100 a day.`);
    else if (code === 'insufficient_credits') setError('Out of credits. Buy credits to keep sending.');
    else if (code === 'gmail_not_connected') { setGmailConnected(false); setError('Connect Gmail to send submissions.'); }
    markItem(cardId, message || 'Failed');
    return code === 'daily_limit_reached' || code === 'insufficient_credits' || code === 'gmail_not_connected';
  };

  const openDraft = async (subjectId: string, item: QueueItem) => {
    if (!accountId) return;
    markItem(item.card_id, 'sending');
    const r = await invoke({ action: 'preview', account_id: accountId, subject_id: subjectId, job_id: item.job_id });
    if (!r.ok) { handleFailure(item.card_id, r.code, r.message); return; }
    markItem(item.card_id, '');
    setDraft({ subjectId, item, subject: r.data.subject, body: r.data.body, to: r.data.to, duplicate: r.data.duplicate });
  };

  const send = async (subjectId: string, item: QueueItem, edited?: { subject: string; body: string }) => {
    if (!accountId) return false;
    markItem(item.card_id, 'sending');
    const r = await invoke({ action: 'send', account_id: accountId, subject_id: subjectId, job_id: item.job_id, request_id: crypto.randomUUID(), ...edited });
    if (!r.ok) return !handleFailure(item.card_id, r.code, r.message);
    markItem(item.card_id, 'sent');
    setQueue((q) => q && { ...q, submitted_today: q.submitted_today + 1, used_today: q.used_today + 1,
      subjects: q.subjects.map((s) => s.subject_id === subjectId ? { ...s, submitted_today: s.submitted_today + 1 } : s) });
    return true;
  };

  const skip = async (item: QueueItem) => {
    markItem(item.card_id, 'skipped');
    await supabase.rpc('move_pipeline_card' as never, { p_id: item.card_id, p_stage: 'closed', p_reason: 'not_a_match' } as never);
  };

  const sendTop = async (s: QueueSubject, n: number) => {
    const targets = s.items.filter((i) => i.has_email && !i.duplicate && i.source !== 'career_site' && !busy[i.card_id]).slice(0, n);
    if (targets.length === 0) return;
    stopBulk.current = false;
    setBulk({ subjectId: s.subject_id, done: 0, total: targets.length });
    for (let k = 0; k < targets.length; k++) {
      if (stopBulk.current) break;
      const keepGoing = await send(s.subject_id, targets[k]);
      setBulk({ subjectId: s.subject_id, done: k + 1, total: targets.length });
      if (!keepGoing) break;
      // Paced so the user's own mailbox isn't flagged for bursts.
      if (k < targets.length - 1) await new Promise((res) => setTimeout(res, PACE_MS + Math.random() * 1500));
    }
    setBulk(null);
    setNotice('Done. Sent submissions are in your Inbox and the Tracker.');
    void load();
  };

  const totals = useMemo(() => {
    if (!queue) return { waiting: 0, consultants: 0 };
    return { waiting: queue.subjects.reduce((n, s) => n + s.waiting, 0), consultants: queue.subjects.length };
  }, [queue]);

  const progress = queue ? Math.min(100, Math.round((queue.submitted_today / Math.max(1, queue.target)) * 100)) : 0;
  const capLeft = queue ? Math.max(0, queue.daily_cap - queue.used_today) : 0;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f3f2ee] pb-[calc(4.25rem+env(safe-area-inset-bottom))] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100 sm:pb-0">
      <AppNav />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-[#20242a]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10"><Target size={20} /></span>
                <div>
                  <p className="text-[13px] font-semibold">Today's submissions</p>
                  <p className="text-2xl font-bold tabular-nums">
                    {queue?.submitted_today ?? 0}<span className="text-base font-medium text-gray-400"> / {queue?.target ?? 100}</span>
                  </p>
                </div>
              </div>
              <div className="text-right text-[12px] text-gray-500 dark:text-slate-400">
                <p>{totals.waiting.toLocaleString()} matches waiting across {totals.consultants} consultants</p>
                <p>{capLeft} sends left today{queue && queue.daily_cap < 100 ? ' (trial limit 10 — ' : ''}{queue && queue.daily_cap < 100 && <Link to="/billing" className="font-semibold text-blue-600">buy credits for 100/day</Link>}{queue && queue.daily_cap < 100 ? ')' : ''}</p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
            {gmailConnected === false && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                <span>Submissions are sent from your own Gmail. Connect it to start.</span>
                <button onClick={() => void connectGmail()} disabled={connecting} className="rounded-md bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-700 disabled:opacity-60">
                  {connecting ? 'Opening Google…' : 'Connect Gmail'}
                </button>
              </div>
            )}
            {error && (
              <div className="mt-3 flex items-start justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
                <span>{error}</span><button onClick={() => setError('')}><X size={13} /></button>
              </div>
            )}
            {notice && (
              <div className="mt-3 flex items-start justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                <span>{notice}</span><button onClick={() => setNotice('')}><X size={13} /></button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-1">
            <p className="text-[12px] text-gray-500 dark:text-slate-400">Best matches first. A consultant is never sent to the same requirement twice, even when another vendor reposts it.</p>
            <button onClick={() => void load()} disabled={loading} title="Refresh" className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-white dark:hover:bg-white/5">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {loading && !queue ? (
            <div className="flex justify-center py-16"><LogoSpinner size={22} /></div>
          ) : queue && queue.subjects.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-[13px] text-gray-500 dark:border-white/10 dark:bg-[#20242a]">
              Add your consultants (hotlist) to get matched requirements here every day. <Link to="/tracker" className="font-semibold text-blue-600">Go to Tracker</Link>
            </div>
          ) : queue?.subjects.map((s) => {
            const isOpen = Boolean(open[s.subject_id]);
            const sendable = s.items.filter((i) => i.has_email && !i.duplicate && i.source !== 'career_site' && !busy[i.card_id]).length;
            const running = bulk?.subjectId === s.subject_id;
            return (
              <div key={s.subject_id} className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#20242a]">
                <button onClick={() => setOpen((o) => ({ ...o, [s.subject_id]: !isOpen }))} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/5">
                  {isOpen ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{consultantTitle(s.role_title)}</p>
                    <p className="truncate text-[11px] text-gray-500 dark:text-slate-400">
                      {[s.years_experience ? `${Math.round(s.years_experience)} yrs` : '', s.visa_type, s.location].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {s.resume_url ? (
                    <span className="hidden items-center gap-1 text-[11px] text-emerald-600 sm:inline-flex"><FileText size={12} />Resume</span>
                  ) : (
                    <span className="hidden items-center gap-1 text-[11px] text-amber-600 sm:inline-flex" title="Upload a resume on the Tracker so it's attached"><AlertTriangle size={12} />No resume</span>
                  )}
                  <span className="text-[12px] tabular-nums text-gray-500"><b className="text-gray-900 dark:text-white">{s.submitted_today}</b> today</span>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{s.waiting} waiting</span>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 dark:border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 px-4 py-2 dark:bg-white/[0.03]">
                      <span className="text-[11px] text-gray-500">{sendable} ready to send by email{s.items.some((i) => i.source === 'career_site') ? ' · career-site jobs: Apply on the firm\'s site' : ''}</span>
                      {running ? (
                        <button onClick={() => { stopBulk.current = true; }} className="rounded-md border border-gray-300 px-3 py-1 text-[12px] font-semibold text-gray-700 hover:bg-white">
                          Stop ({bulk!.done}/{bulk!.total})
                        </button>
                      ) : (
                        <button
                          onClick={() => void sendTop(s, Math.min(10, capLeft))}
                          disabled={sendable === 0 || capLeft === 0 || Boolean(bulk) || gmailConnected === false}
                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                        >
                          <Send size={12} />Send top {Math.min(10, sendable, capLeft)}
                        </button>
                      )}
                    </div>
                    {s.items.length === 0 && <p className="px-4 py-6 text-center text-[12px] text-gray-400">No new matches right now. New requirements are matched every 10 minutes.</p>}
                    <ul className="divide-y divide-gray-100 dark:divide-white/5">
                      {s.items.map((i) => {
                        const state = busy[i.card_id];
                        const isCareer = i.source === 'career_site';
                        return (
                          <li key={i.card_id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${state === 'sent' || state === 'skipped' ? 'opacity-50' : ''}`}>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-semibold">{i.title}</p>
                              <p className="truncate text-[11px] text-gray-500 dark:text-slate-400">
                                {[i.poster || i.company, i.location, payOf(i), ago(i.posted_at)].filter(Boolean).join(' · ')}
                                {isCareer && <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700">Career site</span>}
                              </p>
                              {i.duplicate && <p className="text-[11px] text-amber-600">{i.duplicate}</p>}
                              {state && !['sending', 'sent', 'skipped'].includes(state) && <p className="text-[11px] text-red-600">{state}</p>}
                            </div>
                            <span className="text-[11px] tabular-nums text-gray-400" title="Match strength">{Math.round(i.similarity * 100)}%</span>
                            <div className="flex items-center gap-1.5">
                              {state === 'sent' ? (
                                <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600"><Check size={13} />Sent</span>
                              ) : state === 'skipped' ? (
                                <span className="text-[12px] text-gray-400">Skipped</span>
                              ) : isCareer ? (
                                <div className="w-28"><ApplyOnSiteButton lead={{ id: i.job_id, postSource: 'career_site', kind: 'job', applyUrl: i.apply_url, posterName: i.poster ?? '' }} variant="panel" subjectId={s.subject_id} onApplied={() => void load()} /></div>
                              ) : (
                                <button
                                  onClick={() => void openDraft(s.subject_id, i)}
                                  disabled={!i.has_email || Boolean(i.duplicate) || state === 'sending' || gmailConnected === false}
                                  title={!i.has_email ? 'No email on this post' : undefined}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                                >
                                  {state === 'sending' ? <LogoSpinner size={12} /> : <Mail size={13} />}Submit
                                </button>
                              )}
                              {state !== 'sent' && state !== 'skipped' && (
                                <button onClick={() => void skip(i)} title="Not a match" className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-white/5"><X size={14} /></button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setDraft(null)}>
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-[#20242a] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[14px] font-semibold">Submit to {draft.item.poster || draft.to}</p>
              <button onClick={() => setDraft(null)} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
            </div>
            <p className="mb-2 text-[11px] text-gray-500">To {draft.to} · sent from your Gmail{queue?.subjects.find((s) => s.subject_id === draft.subjectId)?.resume_url ? ', resume attached' : ' (no resume on file)'} · 1 credit</p>
            <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className="mb-2 h-9 w-full rounded-md border border-gray-300 px-2.5 text-[13px] outline-none focus:border-blue-500 dark:border-white/10 dark:bg-transparent" />
            <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={13} className="w-full rounded-md border border-gray-300 p-2.5 text-[13px] leading-relaxed outline-none focus:border-blue-500 dark:border-white/10 dark:bg-transparent" />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="h-9 rounded-md border border-gray-300 px-4 text-[12px] font-semibold hover:bg-gray-50 dark:border-white/10">Cancel</button>
              <button
                onClick={() => { const d = draft; setDraft(null); void send(d.subjectId, d.item, { subject: d.subject, body: d.body }).then(() => void load()); }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-4 text-[12px] font-semibold text-white hover:bg-blue-700"
              >
                <Send size={13} />Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
