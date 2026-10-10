import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, Clock, Eye, History, List, Lock, Mail, Play, Plus, Send, Sparkles, Kanban, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import PostFormModal from '../components/posts/PostFormModal';
import { AiSubmitDialog } from '../components/AiSubmit';
import MatchCard from '../components/match/MatchCard';
import MatchDetail from '../components/match/MatchDetail';
import SwipeDeck from '../components/match/SwipeDeck';
import ProfileSheet from '../components/match/ProfileSheet';
import { Initials } from '../components/match/Visuals';
import ToastBar from '../components/match/ToastBar';
import { useMatchActions } from '../components/match/useMatchActions';
import { useSwipe } from '../components/match/useSwipe';
import { useAuth } from '../contexts/AuthContext';
import { trackEvent } from '../lib/track';
import { loadToday, markViewed, strings, subjectName, type CardItem, type Kind, type Subject, type TodayData } from '../lib/today';

// Today: every new match in one list, as pictures. Open one to see why it
// fits, then Apply (or Ask Resume, for vendors), Save, Share or pass. Cards
// move on their own: applied ones go to Tracker, opened ones to History the
// next day, and unopened ones leave after 3 days.

function useWide() {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export default function TodayPage() {
  const { account, user } = useAuth();
  const accountId = account?.id;
  const kind: Kind = account?.active_persona === 'vendor' ? 'job' : 'hotlist';
  const wide = useWide();

  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  // Swipe is the default view; the list is one tap away.
  const [view, setView] = useState<'swipe' | 'list'>('swipe');
  const [deckId, setDeckId] = useState<string | null>(null);
  // The detail view swipes too: left/right moves to the next/previous match.
  const [sheetDir, setSheetDir] = useState<'n' | 'p' | null>(null);
  const [deckFocus, setDeckFocus] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tip, setTip] = useState(() => { try { return localStorage.getItem('today_tip_hidden') !== '1'; } catch { return true; } });

  const load = useCallback(async () => {
    try {
      const d = await loadToday(kind);
      setData(d);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load your matches.');
    } finally {
      setLoading(false);
    }
  }, [kind]);
  useEffect(() => { setLoading(true); void load(); }, [load]);

  const subjects = useMemo(() => Object.fromEntries((data?.subjects ?? []).map((s) => [s.id, s])) as Record<string, Subject>, [data?.subjects]);
  const items = useMemo(() => (data?.items ?? []).filter((i) => i.lead && (filter === 'all' || i.subject_id === filter)), [data?.items, filter]);
  const countFor = (id: string) => (data?.items ?? []).filter((i) => i.subject_id === id).length;
  const totalNew = data?.items.length ?? 0;
  const locked = (data?.subjects ?? []).reduce((n, s) => n + (s.locked || 0), 0);


  // On a wide screen the first match is open beside the list.
  // On desktop the detail of the swipe card (or the picked list card) sits beside it.
  const listCurrent = wide && view === 'list' ? items.find((i) => i.card_id === selected) ?? items[0] ?? null : null;
  const current = wide ? (view === 'swipe' ? items.find((i) => i.card_id === deckId) ?? null : listCurrent) : null;
  useEffect(() => { if (listCurrent && !listCurrent.viewed_at) see(listCurrent); }, [listCurrent?.card_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const switchView = (next: 'swipe' | 'list') => { setView(next); trackEvent('today_view_changed', { view: next }); };
  const sheetItem = !wide && openId ? (data?.items ?? []).find((i) => i.card_id === openId) ?? null : null;
  const stepSheet = (d: 1 | -1) => {
    const idx = items.findIndex((i) => i.card_id === openId);
    const target = idx >= 0 ? items[idx + d] : undefined;
    if (!target) return;
    see(target);
    setSheetDir(d > 0 ? 'n' : 'p');
    setOpenId(target.card_id);
  };
  const closeSheet = () => { setDeckFocus(openId); setOpenId(null); setSheetDir(null); };
  const sheetSwipe = useSwipe(() => stepSheet(1), () => stepSheet(-1));

  const patch = (cardId: string, change: Partial<CardItem>) =>
    setData((d) => d && { ...d, items: d.items.map((i) => (i.card_id === cardId ? { ...i, ...change } : i)) });

  function see(item: CardItem) {
    if (item.viewed_at) return;
    markViewed(item.card_id);
    patch(item.card_id, { viewed_at: new Date().toISOString() });
  }

  // Takes a card out of the list and opens the one after it.
  function take(item: CardItem): () => void {
    const list = items;
    const idx = list.findIndex((i) => i.card_id === item.card_id);
    const next = list[idx + 1] ?? list[idx - 1] ?? null;
    let position = -1;
    setData((d) => {
      if (!d) return d;
      position = d.items.findIndex((i) => i.card_id === item.card_id);
      return { ...d, items: d.items.filter((i) => i.card_id !== item.card_id) };
    });
    if (selected === item.card_id || (wide && current?.card_id === item.card_id)) setSelected(next?.card_id ?? null);
    if (openId === item.card_id) setOpenId(next?.card_id ?? null);
    return () => setData((d) => {
      if (!d || d.items.some((i) => i.card_id === item.card_id)) return d;
      const copy = [...d.items];
      copy.splice(position < 0 ? copy.length : position, 0, item);
      return { ...d, items: copy };
    });
  }

  const open = (item: CardItem) => {
    see(item);
    if (wide) setSelected(item.card_id); else setOpenId(item.card_id);
  };

  const actions = useMatchActions({ kind, accountId, userId: user?.id, subjects, take, onChanged: () => void load(), onOpen: open });
  const { gmailConnected, connectGmail, busy, appliedNow, applyEmail, applySite, askResume, applyQuick, save, dismiss, share, showToast } = actions;

  // ?profile=<id> opens that profile (from History and Settings).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get('profile');
    if (id && subjects[id]) { setProfileId(id); params.delete('profile'); setParams(params, { replace: true }); }
  }, [params, subjects, setParams]);

  const hideTip = () => { setTip(false); try { localStorage.setItem('today_tip_hidden', '1'); } catch { /* fine */ } };

  // ---- render ----
  const appliedToday = (data?.applied_today ?? 0) + appliedNow;

  const subjectFilter = filter !== 'all' ? subjects[filter] : undefined;
  const profileSubject = profileId ? subjects[profileId] : undefined;
  const label = kind === 'hotlist' ? 'profiles' : 'jobs';
  const target = Math.max(1, data?.target ?? 10);
  const ringC = 2 * Math.PI * 19;

  const cardFor = (item: CardItem) => (
    <MatchCard
      key={item.card_id}
      item={item}
      kind={kind}
      subject={subjects[item.subject_id]}
      selected={wide && current?.card_id === item.card_id}
      showFor={filter === 'all'}
      onOpen={() => open(item)}
      onApply={() => { if (kind === 'hotlist' && item.lead?.source !== 'career_site') open(item); else applyQuick(item); }}
      onSave={() => save(item)}
      onShare={() => void share(item)}
      onDismiss={() => dismiss(item)}
      onSubject={() => setProfileId(item.subject_id)}
    />
  );

  const detailFor = (item: CardItem, mode: 'sheet' | 'pane') => {
    const idx = items.findIndex((i) => i.card_id === item.card_id);
    return (
      <MatchDetail
        key={item.card_id}
        item={item}
        kind={kind}
        subject={subjects[item.subject_id]}
        mode={mode}
        position={{ index: Math.max(0, idx), total: items.length, label: 'Match' }}
        accountId={accountId}
        gmailConnected={gmailConnected}
        busy={busy === item.card_id}
        onBack={closeSheet}
        onPrev={mode === 'sheet' ? () => stepSheet(-1) : undefined}
        onNext={mode === 'sheet' ? () => stepSheet(1) : undefined}
        onApplyEmail={(draft, resumeId) => applyEmail(item, draft, resumeId)}
        onApplySite={() => applySite(item)}
        onAskResume={() => void askResume(item)}
        onSave={() => save(item)}
        onShare={() => void share(item)}
        onDismiss={() => dismiss(item)}
        onSubject={() => setProfileId(item.subject_id)}
        onConnectGmail={() => void connectGmail()}
      />
    );
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f3f2ee] pb-[calc(4.25rem+env(safe-area-inset-bottom))] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100 sm:pb-0">
      <AppNav />
      <div className="mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 grid-cols-[minmax(0,1fr)] gap-4 p-3 sm:p-4 lg:grid-cols-[470px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[24px] font-extrabold tracking-tight">Today</h1>
              <p className="text-[13px] text-gray-600 dark:text-slate-400">
                {loading && !data ? 'Loading your matches…' : totalNew ? `${totalNew} new ${totalNew === 1 ? 'match' : 'matches'} for your ${label}` : 'You are all caught up'}
              </p>
            </div>
            {(data?.subjects.length ?? 0) > 0 && (
              <div className="inline-flex shrink-0 gap-0.5 rounded-full border border-gray-200 bg-white p-[3px] dark:border-white/10 dark:bg-[#20242a]" role="group" aria-label="View">
                <button type="button" aria-pressed={view === 'swipe'} onClick={() => switchView('swipe')}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-extrabold ${view === 'swipe' ? 'bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 text-white shadow-[0_3px_10px_rgba(99,102,241,.35)]' : 'text-gray-600 dark:text-slate-300'}`}>
                  <Play size={12} fill="currentColor" />Swipe
                </button>
                <button type="button" aria-pressed={view === 'list'} onClick={() => switchView('list')}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold ${view === 'list' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-600 dark:text-slate-300'}`}>
                  <List size={14} />List
                </button>
              </div>
            )}
            <div className="relative h-[46px] w-[46px] shrink-0" title={`${appliedToday} applied today`}>
              <svg width="46" height="46" viewBox="0 0 46 46" className="-rotate-90">
                <circle cx="23" cy="23" r="19" fill="none" stroke="var(--pp-ring-track)" strokeWidth="5" />
                <circle cx="23" cy="23" r="19" fill="none" stroke="#059669" strokeWidth="5" strokeLinecap="round" strokeDasharray={ringC} strokeDashoffset={ringC * (1 - Math.min(1, appliedToday / target))} />
              </svg>
              <span className="absolute inset-0 grid place-items-center text-[11.5px] font-extrabold tabular-nums">{appliedToday}</span>
            </div>
          </div>

          {view === 'list' && tip && totalNew > 0 && (
            <div className="flex items-center gap-1.5 rounded-xl border border-dashed border-gray-300 bg-white py-2 pl-2.5 pr-1 dark:border-white/15 dark:bg-[#20242a]">
              {[[Eye, 'Open a match'], [Send, kind === 'hotlist' ? 'Apply' : 'Ask Resume'], [Kanban, 'Track replies']].map(([Icon, text], k) => {
                const I = Icon as typeof Eye;
                return (
                  <div key={String(text)} className="flex flex-1 items-center gap-1.5">
                    {k > 0 && <ChevronRight size={14} className="shrink-0 text-gray-300" />}
                    <div className="flex flex-1 flex-col items-center gap-1 text-center text-[11px] font-semibold leading-tight text-gray-600 dark:text-slate-300">
                      <i className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 not-italic text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"><I size={15} /></i>{String(text)}
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={hideTip} aria-label="Hide tips" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"><X size={14} /></button>
            </div>
          )}

          {view === 'list' && kind === 'hotlist' && gmailConnected === false && totalNew > 0 && (
            <button type="button" onClick={() => void connectGmail()} className="flex items-center gap-2.5 rounded-xl bg-amber-50 px-3 py-2.5 text-left text-[13px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              <Mail size={16} className="shrink-0" /><span className="flex-1">Connect Gmail to apply by email. Applications go from your own address.</span><ChevronRight size={16} />
            </button>
          )}
          {locked > 0 && (
            <Link to="/billing" className="flex items-center gap-2.5 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              <Lock size={16} className="shrink-0" /><span className="flex-1">{locked} new {locked === 1 ? 'match is' : 'matches are'} waiting. Top up from ₹100 to see them.</span><ChevronRight size={16} />
            </Link>
          )}

          {(data?.subjects.length ?? 0) > 0 && (
            <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none]" role="group" aria-label={kind === 'hotlist' ? 'Profile' : 'Job'}>
              <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold ${filter === 'all' ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900' : 'border-gray-200 bg-white text-gray-600 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-300'}`}>
                All <span className="font-bold tabular-nums opacity-70">{totalNew}</span>
              </button>
              {data!.subjects.map((s) => (
                <button key={s.id} type="button" onClick={() => setFilter(s.id)} aria-pressed={filter === s.id}
                  className={`inline-flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-[13px] font-semibold ${filter === s.id ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900' : 'border-gray-200 bg-white text-gray-600 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-300'}`}>
                  <Initials name={subjectName(kind, s)} id={s.id} size={22} />
                  <span className="truncate">{subjectName(kind, s)}</span>
                  <span className="font-bold tabular-nums opacity-70">{countFor(s.id)}</span>
                </button>
              ))}
              <button type="button" onClick={() => setAdding(true)} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1 text-[13px] font-semibold text-blue-600 dark:border-white/15 dark:text-blue-400">
                <Plus size={14} />Add
              </button>
            </div>
          )}

          {view === 'list' && subjectFilter && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-gray-200 bg-white py-2.5 pl-3 pr-2.5 dark:border-white/10 dark:bg-[#20242a]">
              <Initials name={subjectName(kind, subjectFilter)} id={subjectFilter.id} size={38} />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[14.5px]">{subjectName(kind, subjectFilter)}</b>
                <small className="block truncate text-[12px] text-gray-400">
                  {[kind === 'hotlist' ? subjectFilter.title : null, subjectFilter.visa, strings(subjectFilter.locations)[0] ?? subjectFilter.location, subjectFilter.rate_min ? `$${Math.round(subjectFilter.rate_min)}/hr` : null].filter(Boolean).join(' · ')}
                </small>
              </div>
              <button type="button" onClick={() => setProfileId(subjectFilter.id)} className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-gray-200 px-3 text-[13px] font-bold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">
                {kind === 'hotlist' ? 'Profile' : 'Job'}<ChevronRight size={15} />
              </button>
            </div>
          )}

          {view === 'swipe' && !loadError && (data?.subjects.length ?? 0) > 0 ? (
            <div className="min-h-0 flex-1 pb-1">
              <SwipeDeck
                key={filter}
                inline
                hideDetails={wide}
                items={items}
                kind={kind}
                subjects={subjects}
                startId={null}
                focusId={deckFocus}
                appliedToday={appliedToday}
                onCurrent={(i) => setDeckId(i?.card_id ?? null)}
                onSeen={see}
                onApply={applyQuick}
                onSave={save}
                onShare={(i) => void share(i)}
                onDismiss={dismiss}
                onDetails={(i) => open(i)}
              />
            </div>
          ) : (
          <div className="-mx-1 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-1 pb-4">
            {loading && !data ? (
              <div className="flex justify-center py-16"><LogoSpinner size={20} /></div>
            ) : loadError ? (
              <p className="rounded-2xl bg-white p-6 text-center text-[13px] text-red-600 dark:bg-[#20242a]">{loadError}</p>
            ) : (data?.subjects.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center dark:border-white/10 dark:bg-[#20242a]">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/15"><Plus size={26} /></span>
                <h3 className="text-[18px] font-extrabold">{kind === 'hotlist' ? 'Add your first profile' : 'Post your first job'}</h3>
                <p className="max-w-[32ch] text-[13.5px] text-gray-600 dark:text-slate-400">{kind === 'hotlist' ? 'Upload a resume or paste a hotlist line. Matching jobs start arriving here in about 10 minutes.' : 'Paste the job. Matching profiles start arriving here in about 10 minutes.'}</p>
                <button type="button" onClick={() => setAdding(true)} className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-blue-600 px-4 text-[14px] font-bold text-white"><Plus size={16} />{kind === 'hotlist' ? 'Add profile' : 'Add job'}</button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center dark:border-white/10 dark:bg-[#20242a]">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15"><Clock size={26} /></span>
                <h3 className="text-[18px] font-extrabold">{totalNew ? `Nothing new for ${subjectName(kind, subjectFilter)}` : 'All caught up'}</h3>
                <p className="max-w-[32ch] text-[13.5px] text-gray-600 dark:text-slate-400">New matches arrive every 10 minutes. Your phone gets a notification when they do.</p>
                <div className="mt-1 flex flex-wrap justify-center gap-2">
                  <Link to="/history" className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-gray-200 px-4 text-[14px] font-bold dark:border-white/10"><History size={16} />History</Link>
                  <Link to="/match" className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-blue-600 px-4 text-[14px] font-bold text-white"><Sparkles size={16} />Run AI Match</Link>
                </div>
              </div>
            ) : (
              <>
                {items.map(cardFor)}
                <div className="grid grid-cols-3 gap-2 pt-1" aria-label="How Today keeps itself clean">
                  {[[Send, 'Applied', 'moves to Tracker'], [Eye, 'Opened', 'moves to History tomorrow'], [Clock, 'Not opened', 'leaves after 3 days']].map(([Icon, title, text]) => {
                    const I = Icon as typeof Eye;
                    return (
                      <div key={String(title)} className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-gray-300 bg-white px-2 py-2.5 text-center dark:border-white/15 dark:bg-[#20242a]">
                        <i className="grid h-[30px] w-[30px] place-items-center rounded-full bg-gray-100 not-italic text-gray-600 dark:bg-white/10 dark:text-slate-300"><I size={15} /></i>
                        <b className="text-[12.5px]">{String(title)}</b>
                        <span className="text-[11px] leading-tight text-gray-400">{String(text)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          )}
        </div>

        {wide && (
          <div className="min-h-0 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#20242a]">
            {current ? detailFor(current, 'pane') : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-gray-400">
                <Sparkles size={28} /><b className="text-[16px] text-gray-700 dark:text-slate-200">{view === 'swipe' && items.length === 0 ? 'All caught up' : 'Pick a match'}</b>
                <p className="max-w-[34ch] text-[13px]">Why it fits, the post, and your application show here.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {sheetItem && (
        <div className="fixed inset-0 z-[70] overflow-hidden bg-[#f3f2ee] pt-[env(safe-area-inset-top)] animate-[ppSheetIn_.22s_ease-out] dark:bg-[#1B1D21]" role="dialog" aria-label="Match" {...sheetSwipe}>
          <div key={sheetItem.card_id} className={`h-full ${sheetDir === 'n' ? 'animate-[ppSwipeIn_.25s_ease-out]' : sheetDir === 'p' ? 'animate-[ppSwipeBack_.25s_ease-out]' : ''}`}>
            {detailFor(sheetItem, 'sheet')}
          </div>
        </div>
      )}

      {profileSubject && (wide ? (
        <>
          <div className="fixed inset-0 z-[74] bg-slate-900/35" onClick={() => setProfileId(null)} aria-hidden="true" />
          <div className="fixed bottom-0 right-0 top-0 z-[75] w-[560px] max-w-full shadow-2xl animate-[ppSheetIn_.22s_ease-out]" role="dialog" aria-label="Profile">
            <ProfileSheet subject={profileSubject} kind={kind} newCount={countFor(profileSubject.id)} accountId={accountId} mode="drawer"
              onClose={() => setProfileId(null)} onSeeMatches={() => { setFilter(profileSubject.id); setProfileId(null); }} onChanged={() => void load()} showToast={(m) => showToast(m)} />
          </div>
        </>
      ) : (
        <div className="fixed inset-0 z-[75] pt-[env(safe-area-inset-top)] animate-[ppSheetIn_.22s_ease-out]" role="dialog" aria-label="Profile">
          <ProfileSheet subject={profileSubject} kind={kind} newCount={countFor(profileSubject.id)} accountId={accountId} mode="sheet"
            onClose={() => setProfileId(null)} onSeeMatches={() => { setFilter(profileSubject.id); setProfileId(null); setOpenId(null); }} onChanged={() => void load()} showToast={(m) => showToast(m)} />
        </div>
      ))}

      <ToastBar toast={actions.toast} onClose={() => actions.setToast(null)} />

      {adding && (
        <PostFormModal kind={kind} existingPost={null} onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); showToast(kind === 'hotlist' ? 'Profile added. First matches in about 10 minutes.' : 'Job added. First matches in about 10 minutes.'); void load(); }}
          showToast={(m) => showToast(m)} />
      )}
      <AiSubmitDialog ai={actions.ai} />
    </div>
  );
}
