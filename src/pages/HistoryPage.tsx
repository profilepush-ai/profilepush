import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bookmark, Check, Copy, Download, Eye, Send } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import { AiSubmitDialog } from '../components/AiSubmit';
import MatchDetail from '../components/match/MatchDetail';
import MatchSheet from '../components/match/MatchSheet';
import ToastBar from '../components/match/ToastBar';
import ApplyFrame from '../components/match/ApplyFrame';
import { useMatchActions } from '../components/match/useMatchActions';
import { useSwipe } from '../components/match/useSwipe';
import { useAuth } from '../contexts/AuthContext';
import { loadHistory, setNotes, setStatus, subjectsOf, type CardItem, type Kind } from '../lib/today';
import { copyRows, downloadCsv, sheetRows } from '../lib/sheet';

type Tab = 'viewed' | 'saved' | 'applied';
const TABS: Array<{ key: Tab; label: string; icon: typeof Eye }> = [
  { key: 'viewed', label: 'Viewed', icon: Eye },
  { key: 'saved', label: 'Saved', icon: Bookmark },
  { key: 'applied', label: 'Applied', icon: Send },
];
const DATE: Record<Tab, string> = { viewed: 'Viewed', saved: 'Saved', applied: 'Applied' };
const EMPTY: Record<Tab, [string, string]> = {
  viewed: ['Nothing viewed yet', 'Matches you open move here when their 24 hours in Today are up.'],
  saved: ['Nothing saved', 'Tap the bookmark on any match. Saving is free and saved matches never expire.'],
  applied: ['No applications yet', 'Everything you apply to is listed here.'],
};

// History: matches you opened and left (Viewed), kept (Saved), and every
// application (Applied), each as a sheet. Click a Viewed or Saved row to open
// it (and still apply); Copy rows / CSV take it to their own tracker.
export default function HistoryPage() {
  const { account, user } = useAuth();
  const navigate = useNavigate();
  const kind: Kind = account?.active_persona === 'vendor' ? 'job' : 'hotlist';
  const [params, setParams] = useSearchParams();
  const tab = (['viewed', 'saved', 'applied'].includes(params.get('tab') ?? '') ? params.get('tab') : 'viewed') as Tab;
  const [items, setItems] = useState<CardItem[] | null>(null);
  const [counts, setCounts] = useState<Record<Tab, number> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await loadHistory(kind, tab);
      setItems(d?.items ?? []);
      setCounts(d?.counts ?? null);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load History.'); }
  }, [kind, tab]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  const subjects = useMemo(() => subjectsOf(items ?? []), [items]);
  const open = (item: CardItem) => { setOpenId(item.card_id); actions.checkFrame(item); };
  const take = (item: CardItem) => {
    let position = -1;
    setItems((list) => {
      if (!list) return list;
      position = list.findIndex((i) => i.card_id === item.card_id);
      return list.filter((i) => i.card_id !== item.card_id);
    });
    if (openId === item.card_id) setOpenId(null);
    return () => setItems((list) => {
      if (!list || list.some((i) => i.card_id === item.card_id)) return list;
      const copy = [...list];
      copy.splice(position < 0 ? copy.length : position, 0, item);
      return copy;
    });
  };
  const actions = useMatchActions({ kind, accountId: account?.id, userId: user?.id, subjects, take, onChanged: () => void loadHistory(kind, tab).then((d) => d && setCounts(d.counts)), onOpen: open });
  const openItem = openId ? (items ?? []).find((i) => i.card_id === openId) ?? null : null;
  // Swipe left/right in the detail for the next/previous one.
  const [dir, setDir] = useState<'n' | 'p' | null>(null);
  const step = (d: 1 | -1) => {
    const list = items ?? [];
    const target = list[list.findIndex((i) => i.card_id === openId) + d];
    if (!target || !openId) return;
    setDir(d > 0 ? 'n' : 'p');
    setOpenId(target.card_id);
  };
  const swipe = useSwipe(() => step(1), () => step(-1));

  const changeStatus = async (item: CardItem, status: string) => {
    const stage = status === 'applied' ? 'submitted' : ['not_selected', 'no_response', 'job_closed'].includes(status) ? 'closed' : status;
    setItems((list) => list && list.map((i) => (i.card_id === item.card_id ? { ...i, stage, closed_reason: stage === 'closed' ? status : null } : i)));
    try { await setStatus(item.card_id, status); } catch { void load(); }
  };

  const toProfile = (id: string) => navigate(`/today?profile=${id}`);
  const changeNotes = async (item: CardItem, notes: string) => {
    setItems((list) => list && list.map((i) => (i.card_id === item.card_id ? { ...i, notes } : i)));
    try { await setNotes(item.card_id, notes); } catch { /* the cell keeps what they typed */ }
  };
  const dateOf = (i: CardItem) => (tab === 'viewed' ? i.viewed_at : tab === 'saved' ? i.saved_at : i.applied_at);
  const [copied, setCopied] = useState(false);
  const exportRows = () => sheetRows(items ?? [], kind, tab === 'applied' ? 'tracker' : 'history', DATE[tab], dateOf);
  const copy = () => { void copyRows(exportRows()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 4000); }); };
  const control = 'h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-[13px] font-semibold text-gray-700 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-200';

  return (
    <div className="min-h-[100dvh] bg-[#f3f2ee] pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100 sm:pb-10">
      <AppNav />
      <main className="mx-auto w-full max-w-[1400px] space-y-2 px-2 pt-2 sm:px-4 sm:pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-9 rounded-lg border border-gray-200 bg-white p-[3px] dark:border-white/10 dark:bg-[#20242a]" role="tablist">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setParams({ tab: key }, { replace: true }); setOpenId(null); }}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold tabular-nums ${tab === key ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-600 dark:text-slate-300'}`}>
                <Icon size={14} />{label}{counts ? ` ${counts[key]}` : ''}
              </button>
            ))}
          </div>
          {(items ?? []).length > 0 && (
            <span className="ml-auto flex items-center gap-2">
              <button type="button" onClick={copy} title="Copy these rows, then paste them into Google Sheets or Excel" className={`${control} inline-flex items-center gap-1.5`}>
                {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy rows'}
              </button>
              {copied && <a href="https://sheets.new" target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-blue-600 hover:underline">Paste in Google Sheets</a>}
              <button type="button" onClick={() => downloadCsv(exportRows(), `profilepush-${tab}`)} title="Download as CSV" className={`${control} inline-flex items-center gap-1.5`}><Download size={15} />CSV</button>
            </span>
          )}
        </div>

        {items == null && !error ? <div className="flex justify-center py-16"><LogoSpinner size={20} /></div> : error ? (
          <p className="rounded-2xl bg-white p-6 text-center text-[13px] text-red-600 dark:bg-[#20242a]">{error}</p>
        ) : (items ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-10 text-center dark:border-white/10 dark:bg-[#20242a]">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/15">{(() => { const I = TABS.find((t) => t.key === tab)!.icon; return <I size={26} />; })()}</span>
            <h3 className="text-[18px] font-extrabold">{EMPTY[tab][0]}</h3>
            <p className="max-w-[34ch] text-[13.5px] text-gray-600 dark:text-slate-400">{EMPTY[tab][1]}</p>
          </div>
        ) : tab === 'applied' ? (
          <MatchSheet items={items!} kind={kind} mode="tracker" dateLabel={DATE[tab]} dateOf={dateOf}
            onOpen={(i) => i.lead && navigate(`/${i.lead.kind === 'job' ? 'job' : 'hotlist'}/${i.lead.id}`)}
            onStatus={(i, st) => void changeStatus(i, st)} onNotes={(i, n) => void changeNotes(i, n)} />
        ) : (
          <MatchSheet items={items!} kind={kind} mode="history" dateLabel={DATE[tab]} dateOf={dateOf} onOpen={open} />
        )}
      </main>

      {openItem && (
        <>
          <div className="fixed inset-0 z-[69] hidden bg-slate-900/35 lg:block" onClick={() => setOpenId(null)} aria-hidden="true" />
          <div className="fixed inset-0 z-[70] overflow-hidden bg-[#f3f2ee] pt-[env(safe-area-inset-top)] animate-[ppSheetIn_.22s_ease-out] dark:bg-[#1B1D21] lg:left-auto lg:w-[760px] lg:shadow-2xl" role="dialog" aria-label="Match" {...swipe}>
            <div key={openItem.card_id} className={`h-full ${dir === 'n' ? 'animate-[ppSwipeIn_.25s_ease-out]' : dir === 'p' ? 'animate-[ppSwipeBack_.25s_ease-out]' : ''}`}>
            <MatchDetail
              item={openItem} kind={kind} subject={subjects[openItem.subject_id]} mode="sheet"
              position={{ index: (items ?? []).findIndex((i) => i.card_id === openItem.card_id), total: (items ?? []).length, label: tab === 'saved' ? 'Saved' : 'Viewed' }}
              accountId={account?.id} gmailConnected={actions.gmailConnected} busy={actions.busy === openItem.card_id}
              onBack={() => { setOpenId(null); setDir(null); }}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onApplyEmail={(draft, resumeId) => actions.applyEmail(openItem, draft, resumeId)}
              onApplySite={() => actions.applySite(openItem)}
              onAskResume={() => void actions.askResume(openItem)}
              onSave={() => actions.save(openItem)}
              onShare={() => void actions.share(openItem)}
              onSubject={() => toProfile(openItem.subject_id)}
              onConnectGmail={() => void actions.connectGmail()}
              asked={actions.asked[openItem.lead_id]}
              onAsk={(q) => void actions.ask(openItem, q)}
            />
            </div>
          </div>
        </>
      )}
      {actions.frame && (
        <ApplyFrame item={actions.frame.item} url={actions.frame.url} embed={actions.frame.embed} kind={kind} subject={subjects[actions.frame.item.subject_id]} onClose={() => actions.setFrame(null)} />
      )}
      <ToastBar toast={actions.toast} onClose={() => actions.setToast(null)} />
      <AiSubmitDialog ai={actions.ai} />
    </div>
  );
}
