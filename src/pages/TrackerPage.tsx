import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Copy, Download, Search, Target } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import MatchSheet from '../components/match/MatchSheet';
import { useAuth } from '../contexts/AuthContext';
import { leadOrg, leadTitle, loadTracker, setNotes, setStatus, subjectName, type CardItem, type Kind } from '../lib/today';
import { maybeAskForPlayReview } from '../lib/rate';
import { copyRows, downloadCsv, sheetRows } from '../lib/sheet';
import { trackEvent } from '../lib/track';

// Tracker: the applications as a sheet, one row each. Statuses change on
// their own (a reply, the job closing, two quiet weeks moves one to Past) and
// in the Status cell; Notes is theirs to type in. Copy rows pastes straight
// into their own Google Sheet or Excel; CSV downloads it.
export default function TrackerPage() {
  const { account, user } = useAuth();
  const kind: Kind = account?.active_persona === 'vendor' ? 'job' : 'hotlist';
  const [items, setItems] = useState<CardItem[] | null>(null);
  const [error, setError] = useState('');
  const [how, setHow] = useState<'all' | 'email' | 'site'>('all');
  const [who, setWho] = useState('all');
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try { setItems((await loadTracker(kind))?.items ?? []); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the Tracker.'); }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

  const all = useMemo(() => items ?? [], [items]);
  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of all) if (!seen.has(i.subject_id)) seen.set(i.subject_id, subjectName(kind, i.subject));
    return [...seen.entries()];
  }, [all, kind]);
  const shown = all.filter((i) => (how === 'all' || i.how === how) && (who === 'all' || i.subject_id === who));
  const active = shown.filter((i) => i.stage !== 'closed');
  const past = shown.filter((i) => i.stage === 'closed');

  const [view, setView] = useState<'live' | 'past' | 'all'>('live');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (view === 'live' ? active : view === 'past' ? past : shown).filter((i) => {
    if (!words.length || !i.lead) return true;
    const hay = [leadTitle(i.lead), leadOrg(i.lead), i.lead.location, subjectName(kind, i.subject), i.notes].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const reached = (list: string[]) => all.filter((i) => list.includes(i.stage)).length;

  const changeStatus = async (item: CardItem, status: string) => {
    const before = items;
    const stage = status === 'applied' ? 'submitted' : ['not_selected', 'no_response', 'job_closed'].includes(status) ? 'closed' : status;
    setItems((list) => list && list.map((i) => (i.card_id === item.card_id ? { ...i, stage, closed_reason: stage === 'closed' ? status : null } : i)));
    try {
      await setStatus(item.card_id, status);
      // A good moment to ask for a Google Play rating.
      if (status === 'interview' || status === 'placed') maybeAskForPlayReview(`tracker_${status}`);
    } catch { setItems(before); }
  };
  const changeNotes = async (item: CardItem, notes: string) => {
    setItems((list) => list && list.map((i) => (i.card_id === item.card_id ? { ...i, notes } : i)));
    try { await setNotes(item.card_id, notes); } catch { /* the cell keeps what they typed */ }
  };
  const exportRows = () => sheetRows(rows, kind, 'tracker', 'Applied', (i) => i.applied_at);
  const copy = () => {
    void copyRows(exportRows()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 4000); trackEvent('tracker_copied', { rows: rows.length }); });
  };

  const control = 'h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-[13px] font-semibold text-gray-700 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-200';

  return (
    <div className="min-h-[100dvh] bg-[#f3f2ee] pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100 sm:pb-10">
      <AppNav />
      <main className="mx-auto w-full max-w-[1400px] space-y-2 px-2 pt-2 sm:px-4 sm:pt-3">
        {items == null && !error ? <div className="flex justify-center py-16"><LogoSpinner size={20} /></div> : error ? (
          <p className="rounded-2xl bg-white p-6 text-center text-[13px] text-red-600 dark:bg-[#20242a]">{error}</p>
        ) : all.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-10 text-center dark:border-white/10 dark:bg-[#20242a]">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/15"><Target size={26} /></span>
            <h3 className="text-[18px] font-extrabold">No applications yet</h3>
            <p className="max-w-[32ch] text-[13.5px] text-gray-600 dark:text-slate-400">{kind === 'hotlist' ? 'Apply to a match in Today and it shows up here.' : 'Ask for a resume in Today and it shows up here.'}</p>
            <Link to="/today" className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-blue-600 px-4 text-[14px] font-bold text-white"><Target size={16} />Go to Today</Link>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 dark:border-white/10 dark:bg-[#20242a] sm:max-w-[280px]">
                <Search size={15} className="shrink-0 text-gray-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search applications" className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
              </label>
              <div className="inline-flex h-9 rounded-lg border border-gray-200 bg-white p-[3px] dark:border-white/10 dark:bg-[#20242a]" role="group" aria-label="Show">
                {([['live', `Live ${active.length}`], ['past', `Past ${past.length}`], ['all', 'All']] as const).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
                    className={`rounded-md px-2.5 text-[12.5px] font-semibold tabular-nums ${view === k ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-600 dark:text-slate-300'}`}>{l}</button>
                ))}
              </div>
              {people.length > 1 && (
                <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={kind === 'hotlist' ? 'Profile' : 'Job'} className={`${control} max-w-[200px]`}>
                  <option value="all">{kind === 'hotlist' ? 'All profiles' : 'All jobs'}</option>
                  {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              )}
              {kind === 'hotlist' && (
                <select value={how} onChange={(e) => setHow(e.target.value as typeof how)} aria-label="How" className={control}>
                  <option value="all">Email and site</option><option value="email">By email</option><option value="site">On site</option>
                </select>
              )}
              <span className="ml-auto flex items-center gap-2">
                <button type="button" onClick={copy} title="Copy these rows, then paste them into Google Sheets or Excel" className={`${control} inline-flex items-center gap-1.5`}>
                  {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy rows'}
                </button>
                {copied && <a href="https://sheets.new" target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-blue-600 hover:underline">Paste in Google Sheets</a>}
                <button type="button" onClick={() => downloadCsv(exportRows(), 'profilepush-tracker')} title="Download as CSV" className={`${control} inline-flex items-center gap-1.5`}><Download size={15} />CSV</button>
              </span>
            </div>
            <p className="px-0.5 text-[12px] tabular-nums text-gray-500 dark:text-slate-400">
              {all.length} applied · {reached(['replied', 'interview', 'placed'])} replied · {reached(['interview', 'placed'])} interviews · {reached(['placed'])} placed · statuses update themselves
            </p>
            {rows.length ? (
              <MatchSheet items={rows} kind={kind} mode="tracker" dateLabel="Applied" dateOf={(i) => i.applied_at} viewerId={user?.id}
                onOpen={(i) => i.lead && navigate(`/${i.lead.kind === 'job' ? 'job' : 'hotlist'}/${i.lead.id}`)}
                onStatus={(i, st) => void changeStatus(i, st)} onNotes={(i, n) => void changeNotes(i, n)} />
            ) : <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-[13px] text-gray-400 dark:border-white/10 dark:bg-[#20242a]">Nothing here.</p>}
          </>
        )}
      </main>
    </div>
  );
}
