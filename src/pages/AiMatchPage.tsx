import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, FileText, Paperclip, Sparkles, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import { LoaderMark } from '../components/brand/BrandLoader';
import { useAuth } from '../contexts/AuthContext';
import { supabase, supabaseAnonKey, supabaseFunctionsUrl, buildSupabaseFunctionHeaders } from '../lib/supabase';
import { trackEvent } from '../lib/track';

// AI Match, one thing on the screen: paste a resume (or a job) or drop the
// file, and go. While it works, the brand mark and what it's doing; when it's
// done, its matches are Today matches for that profile (ai_match_to_today)
// and Today opens full screen on them. Examples run as samples: matched for
// real, never saved as the user's post, so they're shown here.

type Target = 'jobs' | 'hotlist';
type RunResult = { results?: Row[]; top_blockers?: Array<{ reason: string; count: number }> };
type Row = { lead_id: string; ai_score?: number; similarity?: number; title?: string | null; job_title?: string | null; role_title?: string | null; company_name?: string | null; company?: string | null; location?: string | null; candidate_name?: string | null };

const MIN_CHARS = 40;
// AI Match scores 1 to 10; shown as a percentage.
const pctOf = (score: unknown) => { const n = Number(score ?? 0); return Math.round(n <= 10 ? n * 10 : n); };
const EXAMPLES: Record<Target, string[]> = {
  jobs: [
    'Sr. Java Full Stack Developer, 11 yrs, Spring Boot, React, AWS, Kafka. H1B, open to relocate, $65/hr C2C',
    'Data Engineer, 9 yrs, Snowflake, dbt, Airflow, Python. USC, remote, $75/hr',
    'DevOps Engineer, 7 yrs, AWS, Terraform, Kubernetes, Jenkins. H1B transfer, $68/hr C2C',
  ],
  hotlist: [
    'Sr. Java Developer: Spring Boot, Microservices, AWS. 10+ yrs, Jersey City NJ hybrid, C2C',
    'Salesforce Developer: Apex, LWC, 8+ yrs, remote, USC/GC only, $70/hr W2',
    'Data Engineer: Snowflake, dbt, Python. 8+ yrs, Austin TX onsite, C2C $75/hr',
  ],
};

// The box's placeholder types itself out, one example after another.
function useTypewriter(lines: string[], on: boolean) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!on) { setText(''); return undefined; }
    let line = 0, n = 0, back = false, t: ReturnType<typeof setTimeout>;
    const step = () => {
      const full = lines[line % lines.length];
      n += back ? -1 : 1;
      setText(full.slice(0, n));
      if (!back && n >= full.length) { back = true; t = setTimeout(step, 2200); return; }
      if (back && n <= 0) { back = false; line += 1; }
      t = setTimeout(step, back ? 12 : 28);
    };
    t = setTimeout(step, 400);
    return () => clearTimeout(t);
  }, [lines, on]);
  return text;
}

export default function AiMatchPage() {
  const { account, refreshAccount } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [target, setTarget] = useState<Target>(account?.active_persona === 'vendor' ? 'hotlist' : 'jobs');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [running, setRunning] = useState<{ label: string; pct: number | null; found: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState<{ rows: Row[]; best: number; sample: boolean; subjectId: string | null; blockers: Array<{ reason: string; count: number }> } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const placeholder = useTypewriter(EXAMPLES[target], !text && !running && !done);

  useEffect(() => { if (account?.active_persona) setTarget(account.active_persona === 'vendor' ? 'hotlist' : 'jobs'); }, [account?.active_persona]);
  useEffect(() => {
    if (!running) return undefined;
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  const readFile = async (file: File) => {
    setReading(true); setError(''); setFileName(file.name);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('resume', file, file.name);
      form.append('text_only', 'true');
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch(`${supabaseFunctionsUrl}/parse-resume`, { method: 'POST', headers, body: form });
      const payload = await res.json().catch(() => null) as { plain_text?: string; error?: string } | null;
      const plain = (payload?.plain_text ?? '').trim();
      if (!res.ok || !plain) { setFileName(''); setError(payload?.error ?? 'That file had no readable text. Try a PDF or Word file, or paste the text.'); return; }
      setText(plain.slice(0, 8000));
      trackEvent('ai_match_file_read', { type: file.name.split('.').pop()?.toLowerCase() ?? '' });
    } catch {
      setFileName(''); setError("Couldn't read that file. Paste the text instead.");
    } finally {
      setReading(false);
    }
  };

  const run = useCallback(async (description: string, sample = false) => {
    const clean = description.trim();
    if (clean.length < MIN_CHARS) { setError(`Add a little more: at least ${MIN_CHARS} characters.`); box.current?.focus(); return; }
    setError(''); setOutOfCredits(false); setDone(null); setElapsed(0);
    setRunning({ label: 'Reading what you pasted', pct: null, found: 0 });
    const noun = target === 'jobs' ? 'jobs' : 'profiles';
    trackEvent('ai_match_started', { target, sample, chars: clean.length, page: 'v2' });
    try {
      const auth = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession()) as { Authorization?: string };
      const headers: Record<string, string> = { apikey: supabaseAnonKey, 'Content-Type': 'application/json' };
      if (auth.Authorization) headers.Authorization = auth.Authorization;
      const res = await fetch(`${supabaseFunctionsUrl}/ai-match`, { method: 'POST', headers, body: JSON.stringify({ target, description: clean, stream: true, seen_ids: [], sample }) });
      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => null) as { error?: string; code?: string } | null;
        if (res.status === 402 || payload?.code === 'insufficient_credits') { setOutOfCredits(true); return; }
        setError(payload?.error ?? 'AI Match failed. You have not been charged.');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = null as RunResult | null;
      let failure: string | null = null;
      // Newline-delimited JSON: progress events, the last one the results.
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          if (ev.phase === 'preparing') setRunning((r) => r && { ...r, label: 'Reading what you pasted' });
          else if (ev.phase === 'searching') setRunning((r) => r && { ...r, label: `Searching ${noun} from the last 30 days` });
          else if (ev.phase === 'found') setRunning((r) => r && { ...r, label: `Found ${Number(ev.found ?? 0)} ${noun} to score`, found: Number(ev.found ?? 0) });
          else if (ev.phase === 'scoring') {
            const scored = Number(ev.scored ?? 0), total = Number(ev.total ?? 0);
            setRunning((r) => r && { ...r, label: `Scoring ${scored} of ${total} ${noun}`, pct: total ? Math.min(100, Math.round((scored / total) * 100)) : null });
          } else if (ev.phase === 'error') failure = String(ev.error ?? 'AI Match failed');
          else if (ev.phase === 'done') result = ev as unknown as RunResult;
        }
      }
      if (failure || !result) { setError(failure ?? 'AI Match failed. You have not been charged.'); return; }
      const rows = [...(result.results ?? [])].sort((a, b) => Number(b.ai_score ?? 0) - Number(a.ai_score ?? 0));
      const best = rows.reduce((m, r) => Math.max(m, pctOf(r.ai_score)), 0);
      void refreshAccount();
      // Real runs: the matches become Today matches for the profile (or job) it saved.
      let subjectId: string | null = null;
      if (!sample && rows.length) {
        setRunning((r) => r && { ...r, label: 'Putting them in Today', pct: 100 });
        const { data } = await supabase.rpc('ai_match_to_today' as never, { p_target: target, p_description: clean, p_results: rows } as never);
        subjectId = (data as { subject_id?: string | null } | null)?.subject_id ?? null;
      }
      setDone({ rows, best, sample, subjectId, blockers: result.top_blockers ?? [] });
      trackEvent('ai_match_done', { count: rows.length, best, to_today: Boolean(subjectId) });
      // Close the post it was started from, once it's saved as theirs.
      const from = (location.state as { aiMatchCloseSource?: { kind?: string; id?: string } } | null)?.aiMatchCloseSource;
      if (subjectId && from?.id && (from.kind === 'job' || from.kind === 'hotlist')) {
        void supabase.rpc('set_my_post_status' as never, { p_kind: from.kind, p_id: from.id, p_status: 'closed' } as never);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI Match failed. You have not been charged.');
    } finally {
      setRunning(null);
    }
  }, [target, refreshAccount, location.state]);

  // Sent here from a post ("AI Match this"): its text in the box, and maybe run.
  const seeded = useRef(false);
  useEffect(() => {
    const st = location.state as { aiMatchDescription?: string; aiMatchAutoRun?: boolean } | null;
    if (seeded.current || !st?.aiMatchDescription) return;
    seeded.current = true;
    setText(st.aiMatchDescription);
    if (st.aiMatchAutoRun) void run(st.aiMatchDescription);
  }, [location.state, run]);

  // Matches ready: a moment to see the count, then Today, full screen.
  useEffect(() => {
    if (!done?.subjectId || !done.rows.length) return undefined;
    const t = setTimeout(() => navigate(`/today?for=${done.subjectId}`), 1900);
    return () => clearTimeout(t);
  }, [done, navigate]);

  const chars = text.trim().length;
  const ready = chars >= MIN_CHARS && !reading;

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-[#0B1A3A] sm:pb-10">
      <AppNav />
      <div aria-hidden="true" className="pointer-events-none fixed -right-40 top-10 h-[420px] w-[420px] rounded-full bg-[#2563EB]/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none fixed -left-32 bottom-10 h-[320px] w-[320px] rounded-full bg-[#FACC15]/12 blur-3xl" />

      <main className="relative mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-8 sm:pt-16">
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[12.5px] font-bold text-[#2563EB] shadow-sm ring-1 ring-[#2563EB]/15"><Sparkles size={14} />AI Match</span>
        <h1 className="mt-4 text-balance text-center text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">
          {target === 'jobs' ? <>Paste a resume.<br /><span className="text-[#2563EB]">Get matching jobs.</span></> : <>Paste a job.<br /><span className="text-[#2563EB]">Get matching profiles.</span></>}
        </h1>

        {/* Which way to match. */}
        <div className="mt-6 inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-gray-200" role="group" aria-label="What to find">
          {([['jobs', 'Jobs for a profile'], ['hotlist', 'Profiles for a job']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={target === k} onClick={() => { setTarget(k); setDone(null); setError(''); }}
              className={`h-9 rounded-full px-4 text-[13.5px] font-bold transition ${target === k ? 'bg-[#0B1A3A] text-white' : 'text-gray-600 hover:text-gray-900'}`}>{l}</button>
          ))}
        </div>

        {/* The box: paste, type, or drop a file on it. */}
        <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}
          className={`mt-6 w-full rounded-[28px] bg-white p-2 shadow-[0_20px_60px_rgba(11,26,58,.10)] ring-1 transition ${dragging ? 'ring-2 ring-[#2563EB]' : 'ring-gray-200 focus-within:ring-2 focus-within:ring-[#2563EB]/60'}`}>
          <textarea ref={box} value={text} onChange={(e) => { setText(e.target.value.slice(0, 8000)); setError(''); }} rows={7}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && ready) void run(text); }}
            placeholder={placeholder || (target === 'jobs' ? 'Paste a resume or a consultant’s details…' : 'Paste a job description…')}
            aria-label={target === 'jobs' ? 'Resume or profile' : 'Job description'}
            className="block min-h-[170px] w-full resize-none rounded-[22px] bg-transparent px-4 py-3.5 text-[16px] leading-relaxed outline-none placeholder:text-gray-400 sm:min-h-[200px] sm:text-[17px]" />
          <div className="flex flex-wrap items-center gap-2 px-2 pb-1.5 pt-1">
            <button type="button" onClick={() => fileInput.current?.click()} disabled={reading}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-gray-100 px-3.5 text-[13.5px] font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-60">
              {reading ? <LoaderMark height={14} /> : <Paperclip size={15} />}{reading ? 'Reading…' : target === 'jobs' ? 'Upload resume' : 'Upload job'}
            </button>
            <input ref={fileInput} type="file" accept=".pdf,.docx,.rtf,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readFile(f); }} />
            {fileName && !reading && (
              <span className="inline-flex max-w-[200px] items-center gap-1 truncate rounded-full bg-blue-50 px-2.5 py-1 text-[12px] font-semibold text-blue-700"><FileText size={13} />{fileName}
                <button type="button" aria-label="Clear" onClick={() => { setFileName(''); setText(''); }} className="ml-0.5"><X size={13} /></button></span>
            )}
            <span className="ml-auto hidden text-[12px] tabular-nums text-gray-400 sm:inline">{chars > 0 ? `${chars} characters` : 'or drop a file here'}</span>
            <button type="button" onClick={() => void run(text)} disabled={!ready || Boolean(running)}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#2563EB] px-5 text-[15px] font-extrabold text-white shadow-[0_10px_28px_rgba(37,99,235,.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none sm:ml-0">
              Find matches<ArrowRight size={17} />
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-center text-[13.5px] font-semibold text-red-600">{error}</p>}
        {outOfCredits && (
          <Link to="/billing" className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-[13.5px] font-bold text-amber-800 ring-1 ring-amber-200">Top up to see these matches<ArrowRight size={15} /></Link>
        )}

        {!done && !running && (
          <div className="mt-5 flex flex-col items-center gap-2.5">
            <span className="text-[12.5px] font-semibold text-gray-500">No {target === 'jobs' ? 'resume' : 'job'} handy? Try an example:</span>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES[target].map((ex) => (
                <button key={ex} type="button" onClick={() => { setText(ex); trackEvent('ai_match_sample_clicked', { page: 'v2' }); void run(ex, true); }}
                  className="max-w-[300px] truncate rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-gray-700 ring-1 ring-gray-200 hover:ring-[#2563EB]/50">{ex.split(/[,:]/)[0]}</button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-gray-400">Up to 10 credits a run. Only new matches are charged. It&apos;s saved as your {target === 'jobs' ? 'profile' : 'job'}, so new matches keep coming.</p>
          </div>
        )}

        {/* Done: the count, then Today. Examples and empty runs stay here. */}
        {done && (
          <section className="mt-8 w-full" style={{ animation: 'ppFadeUp .4s ease-out both' }}>
            {done.rows.length === 0 ? (
              <div className="rounded-3xl bg-white p-6 text-center ring-1 ring-gray-200">
                <b className="text-[20px] font-extrabold">No strong matches yet</b>
                <p className="mt-1 text-[14px] text-gray-600">Nothing scored high enough this time.{done.blockers[0] ? ` Most often: ${done.blockers[0].reason.toLowerCase()}.` : ''} Add skills, visa or location and try again. You haven&apos;t been charged.</p>
              </div>
            ) : done.subjectId ? (
              <div className="flex flex-col items-center gap-3 rounded-3xl bg-white p-6 text-center ring-1 ring-gray-200">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-white" style={{ animation: 'ppPop .45s cubic-bezier(.2,.8,.2,1) both' }}><Check size={28} strokeWidth={3} /></span>
                <b className="text-[24px] font-extrabold tracking-tight">{done.rows.length} {done.rows.length === 1 ? 'match' : 'matches'} found</b>
                <p className="text-[14px] text-gray-600">Best match {done.best}%. Opening them in Today…</p>
                <button type="button" onClick={() => navigate(`/today?for=${done.subjectId}`)} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#2563EB] px-5 text-[15px] font-extrabold text-white">Swipe them now<ArrowRight size={17} /></button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-center text-[13.5px] font-semibold text-gray-600">
                  {done.sample ? 'An example run: here are its matches. Paste your own to get yours in Today.' : `${done.rows.length} matches. They couldn't be added to Today this time.`}
                </p>
                {done.rows.slice(0, 12).map((r) => (
                  <Link key={r.lead_id} to={`/${target === 'jobs' ? 'job' : 'hotlist'}/${r.lead_id}`}
                    className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-gray-200 hover:ring-[#2563EB]/40">
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[14.5px]">{r.title || r.job_title || r.role_title || r.candidate_name || 'Match'}</b>
                      <small className="block truncate text-[12.5px] text-gray-500">{[r.company_name || r.company, r.location].filter(Boolean).join(' · ')}</small>
                    </span>
                    <b className="shrink-0 text-[15px] font-extrabold tabular-nums text-[#2563EB]">{pctOf(r.ai_score)}%</b>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Working: the brand mark, what it's doing, and how far along. */}
      {running && (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-6 bg-white/95 px-6 text-center backdrop-blur" role="status" aria-live="polite">
          <LoaderMark height={64} />
          <div>
            <b className="block text-[22px] font-extrabold tracking-tight">{running.label}</b>
            <span className="mt-1 block text-[13px] tabular-nums text-gray-500">{elapsed}s · usually under a minute</span>
          </div>
          <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-[#C8D7FA]">
            {running.pct == null
              ? <i className="block h-full w-1/3 rounded-full bg-[#2563EB]" style={{ animation: 'ppIndeterminate 1.2s ease-in-out infinite' }} />
              : <i className="block h-full rounded-full bg-[#2563EB] transition-[width] duration-500" style={{ width: `${running.pct}%` }} />}
          </div>
        </div>
      )}
    </div>
  );
}
