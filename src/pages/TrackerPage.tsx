import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Clock, Target } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import TrackerRow from '../components/match/TrackerRow';
import { Initials } from '../components/match/Visuals';
import { useAuth } from '../contexts/AuthContext';
import { loadTracker, setStatus, subjectName, type CardItem, type Kind } from '../lib/today';

// Tracker: the applications, live ones first. Statuses change on their own
// (a reply, the job closing, two quiet weeks moves one to Past); the menu on
// each row is there for anything else.
export default function TrackerPage() {
  const { account } = useAuth();
  const kind: Kind = account?.active_persona === 'vendor' ? 'job' : 'hotlist';
  const [items, setItems] = useState<CardItem[] | null>(null);
  const [error, setError] = useState('');
  const [how, setHow] = useState<'all' | 'email' | 'site'>('all');
  const [who, setWho] = useState('all');
  const [pastOpen, setPastOpen] = useState(false);

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

  const reached = (stages: string[]) => all.filter((i) => stages.includes(i.stage)).length;
  const stages: Array<[string, number, string]> = [
    ['Applied', all.length, '#2563eb'],
    ['Replied', reached(['replied', 'interview', 'placed']), '#6366f1'],
    ['Interview', reached(['interview', 'placed']), '#7c3aed'],
    ['Placed', reached(['placed']), '#059669'],
  ];
  const max = Math.max(1, stages[0][1]);

  const changeStatus = async (item: CardItem, status: string) => {
    const before = items;
    const stage = status === 'applied' ? 'submitted' : ['not_selected', 'no_response', 'job_closed'].includes(status) ? 'closed' : status;
    setItems((list) => list && list.map((i) => (i.card_id === item.card_id ? { ...i, stage, closed_reason: stage === 'closed' ? status : null } : i)));
    try { await setStatus(item.card_id, status); } catch { setItems(before); }
  };

  const chip = (on: boolean) => `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold ${on ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900' : 'border-gray-200 bg-white text-gray-600 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-300'}`;

  return (
    <div className="min-h-[100dvh] bg-[#f3f2ee] pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100 sm:pb-10">
      <AppNav />
      <main className="mx-auto w-full max-w-3xl space-y-3 px-3 pt-4 sm:px-4">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight">Tracker</h1>
          <p className="text-[13px] text-gray-600 dark:text-slate-400">Your applications. Statuses update themselves.</p>
        </div>

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
            <div className="space-y-2 rounded-2xl border border-gray-200 bg-white px-3.5 py-3 dark:border-white/10 dark:bg-[#20242a]" role="img" aria-label={stages.map(([l, n]) => `${l} ${n}`).join(', ')}>
              {stages.map(([label, n, color]) => (
                <div key={label} className="grid grid-cols-[72px_1fr_32px] items-center gap-2.5 text-[12.5px] font-bold text-gray-600 dark:text-slate-300">
                  <span>{label}</span>
                  <div className="h-3.5 overflow-hidden rounded-[7px] bg-gray-100 dark:bg-white/5"><i className="block h-full rounded-[7px]" style={{ width: `${n ? Math.max(6, (n / max) * 100) : 0}%`, background: color }} /></div>
                  <b className="text-right text-[15px] tabular-nums text-gray-900 dark:text-white">{n}</b>
                </div>
              ))}
            </div>

            {kind === 'hotlist' && (
              <div className="inline-flex gap-0.5 rounded-[10px] border border-gray-200 bg-white p-[3px] dark:border-white/10 dark:bg-[#20242a]" role="group" aria-label="How">
                {([['all', 'All'], ['email', 'By email'], ['site', 'On site']] as const).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={how === k} onClick={() => setHow(k)}
                    className={`rounded-[7px] px-3 py-1.5 text-[13px] font-semibold ${how === k ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 'text-gray-600 dark:text-slate-300'}`}>{l}</button>
                ))}
              </div>
            )}

            {people.length > 1 && (
              <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none]">
                <button type="button" className={chip(who === 'all')} onClick={() => setWho('all')}>{kind === 'hotlist' ? 'All profiles' : 'All jobs'}</button>
                {people.map(([id, name]) => (
                  <button key={id} type="button" className={`${chip(who === id)} max-w-[220px] pl-1`} onClick={() => setWho(id)}>
                    <Initials name={name} id={id} size={22} /><span className="truncate">{name}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#20242a]">
              {active.length ? active.map((i) => <TrackerRow key={i.card_id} item={i} kind={kind} onStatus={(s) => void changeStatus(i, s)} />)
                : <p className="p-6 text-center text-[13px] text-gray-400">No live applications here.</p>}
            </div>

            <button type="button" onClick={() => setPastOpen((o) => !o)} aria-expanded={pastOpen}
              className="flex w-full items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-left text-gray-600 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-300">
              <Clock size={16} className="shrink-0" />
              <span className="min-w-0 flex-1"><b className="block text-[13.5px] text-gray-900 dark:text-white">Past · {past.length}</b>
                <small className="block text-[11.5px] text-gray-400">No reply in 14 days, job closed or not selected. Moves here on its own.</small></span>
              {pastOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {pastOpen && past.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white opacity-85 dark:border-white/10 dark:bg-[#20242a]">
                {past.map((i) => <TrackerRow key={i.card_id} item={i} kind={kind} onStatus={(s) => void changeStatus(i, s)} />)}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
