import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, ChevronRight, Eye, Flame, History, Lock, Plus, Search, Send, Sparkles, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import PostFormModal from '../components/posts/PostFormModal';
import { AiSubmitDialog } from '../components/AiSubmit';
import MatchDetail from '../components/match/MatchDetail';
import SwipeDeck from '../components/match/SwipeDeck';
import ProfileSheet from '../components/match/ProfileSheet';
import { CompanyLogo, FitRing, Initials } from '../components/match/Visuals';
import ToastBar from '../components/match/ToastBar';
import ApplyFrame from '../components/match/ApplyFrame';
import { useMatchActions } from '../components/match/useMatchActions';
import { useSwipe } from '../components/match/useSwipe';
import { useAuth } from '../contexts/AuthContext';
import { trackEvent } from '../lib/track';
import { loadToday, markViewed, strings, subjectName, type CardItem, type Kind, type Question, type Subject, type TodayData } from '../lib/today';

// Today: every new match, one at a time, as a swipe card. On a phone it is
// full screen, with the search and the profile chips on the card itself; the
// app's header and bottom bar slide in when you swipe up. Open a card for why it fits and the application;
// Apply (Ask Resume, for vendors), Save, Share or Pass. Cards move on their
// own: each stays 24 hours (the card shows the time left), then opened ones
// go to History and unopened ones leave; applied ones go to Tracker.

function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

// About 15 seconds a card: long enough for every detail to land.
const REEL_MS = 15000;

// Time left until `iso`, as "7h 12m", ticking every 30 seconds.
function useCountdown(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  if (!iso) return '';
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

// A short burst of confetti for finishing the reel.
const CONFETTI = ['#34d399', '#60a5fa', '#a78bfa', '#fbbf24', '#f472b6', '#f87171'];
function Confetti() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 30 }, (_, i) => (
        <i key={i} className="absolute top-0 block rounded-[2px]"
          style={{ left: `${(i * 37) % 100}%`, width: 6 + (i % 3) * 2, height: (6 + (i % 3) * 2) * 1.6, background: CONFETTI[i % CONFETTI.length], animation: `ppConfetti ${1300 + (i % 5) * 220}ms cubic-bezier(.2,.6,.4,1) ${(i % 8) * 70}ms both` }} />
      ))}
    </div>
  );
}

// Every word of the search appears somewhere on the card: title, company,
// poster, location, skills or the profile's own name and role.
function matchesSearch(item: CardItem, words: string[]): boolean {
  if (words.length === 0) return true;
  const lead = item.lead;
  const hay = [
    lead?.title, lead?.company, lead?.poster, lead?.location, ...strings(lead?.skills), ...strings(lead?.visas),
    item.subject?.title, item.subject?.name,
  ].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export default function TodayPage() {
  const { account, user } = useAuth();
  const accountId = account?.id;
  const kind: Kind = account?.active_persona === 'vendor' ? 'job' : 'hotlist';
  const wide = useMedia('(min-width: 1024px)');
  // Short phones leave out the map and rate boxes (the badges say the same).
  const tall = useMedia('(min-height: 760px)');

  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [deckId, setDeckId] = useState<string | null>(null);
  // Phones: Today opens full screen. The ⌄ button goes back to the normal
  // page (header and bottom bar); a swipe there goes full screen again.
  const [full, setFull] = useState(true);
  // The detail view swipes too: left/right moves to the next/previous match.
  const [sheetDir, setSheetDir] = useState<'n' | 'p' | null>(null);
  const [deckFocus, setDeckFocus] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [watchedNow, setWatchedNow] = useState(0);

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

  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const subjects = useMemo(() => Object.fromEntries((data?.subjects ?? []).map((s) => [s.id, s])) as Record<string, Subject>, [data?.subjects]);
  const items = useMemo(
    () => (data?.items ?? []).filter((i) => i.lead && (filter === 'all' || i.subject_id === filter) && matchesSearch(i, words)),
    [data?.items, filter, words],
  );
  const countFor = (id: string) => (data?.items ?? []).filter((i) => i.subject_id === id).length;
  const totalNew = data?.items.length ?? 0;
  const locked = (data?.subjects ?? []).reduce((n, s) => n + (s.locked || 0), 0);

  // Desktop: the current swipe card's detail sits beside it.
  const current = wide ? items.find((i) => i.card_id === deckId) ?? null : null;
  const sheetItem = !wide && openId ? (data?.items ?? []).find((i) => i.card_id === openId) ?? null : null;

  const patch = (cardId: string, change: Partial<CardItem>) =>
    setData((d) => d && { ...d, items: d.items.map((i) => (i.card_id === cardId ? { ...i, ...change } : i)) });

  function see(item: CardItem) {
    if (item.viewed_at) return;
    markViewed(item.card_id);
    setWatchedNow((n) => n + 1);
    patch(item.card_id, { viewed_at: new Date().toISOString() });
  }

  // Takes a card out of the list (the deck moves on by itself).
  function take(item: CardItem): () => void {
    const idx = items.findIndex((i) => i.card_id === item.card_id);
    const next = items[idx + 1] ?? items[idx - 1] ?? null;
    let position = -1;
    setData((d) => {
      if (!d) return d;
      position = d.items.findIndex((i) => i.card_id === item.card_id);
      return { ...d, items: d.items.filter((i) => i.card_id !== item.card_id) };
    });
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
    if (!wide) setOpenId(item.card_id);
  };

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

  const actions = useMatchActions({ kind, accountId, userId: user?.id, subjects, take, onChanged: () => void load(), onOpen: open });
  const { gmailConnected, connectGmail, busy, appliedNow, applyEmail, applySite, askResume, applyQuick, save, dismiss, share, showToast } = actions;

  // ?profile=<id> opens that profile (from History and Settings).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get('profile');
    if (id && subjects[id]) { setProfileId(id); params.delete('profile'); setParams(params, { replace: true }); }
  }, [params, subjects, setParams]);

  const appliedToday = (data?.applied_today ?? 0) + appliedNow;
  const reel = data?.reel;
  const free = Boolean(reel && !reel.paid);
  const watchedToday = (reel?.watched_today ?? 0) + watchedNow;
  const countdown = useCountdown(reel?.next_reset);
  const profileSubject = profileId ? subjects[profileId] : undefined;
  const deckKey = `${filter}|${words.join(' ')}`;
  const emptyMessage = words.length && items.length === 0
    ? { title: 'Nothing matches', text: `No matches for "${query.trim()}". Try another word.` }
    : undefined;

  const deckProps = {
    items, kind, subjects, appliedToday, emptyMessage, expiring: true,
    onSeen: see, onApply: applyQuick, onSave: save, onShare: (i: CardItem) => void share(i), onDismiss: dismiss,
    onDetails: (i: CardItem) => open(i),
    asked: actions.asked, onAsk: (i: CardItem, q: Question) => void actions.ask(i, q),
  };

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
        asked={actions.asked[item.lead_id]}
        onAsk={(q) => void actions.ask(item, q)}
      />
    );
  };

  const hasSubjects = (data?.subjects.length ?? 0) > 0;
  // Phones: Today is the swipe card, full screen. Not for a first-time
  // account (nothing posted yet) or an error, which get the plain page.
  const immersive = !wide && full && !loadError && (hasSubjects || (loading && !data));

  // The search, applied count and profile chips, drawn on the dark card.
  const glassChip = (on: boolean) => `inline-flex shrink-0 items-center gap-1.5 rounded-full text-[13px] font-semibold ring-1 ${on
    ? 'bg-white text-gray-900 ring-white'
    : 'bg-white/10 text-white/85 ring-white/15 backdrop-blur'}`;
  const topBar = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/10 pl-3.5 pr-1.5 ring-1 ring-white/15 backdrop-blur focus-within:ring-white/40">
          <Search size={16} className="shrink-0 text-white/60" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={totalNew ? `Search ${totalNew} matches` : 'Search matches'}
            aria-label="Search matches by job, company, skill, location or profile"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/50 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10"><X size={15} /></button>
          )}
        </label>
        {(reel?.streak ?? 0) > 0 && (
          <span title={`${reel!.streak}-day streak`} className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full bg-orange-500/20 px-3 text-[13px] font-extrabold tabular-nums text-orange-300 ring-1 ring-orange-400/25">
            <Flame size={14} fill="currentColor" />{reel!.streak}
          </span>
        )}
        <span title={`${appliedToday} applied today`} className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full bg-emerald-500/20 px-3 text-[13px] font-extrabold tabular-nums text-emerald-300 ring-1 ring-emerald-400/25">
          <Check size={14} strokeWidth={3} />{appliedToday}
        </span>
      </div>
      {locked > 0 && (
        <Link to="/billing" className="flex items-center gap-2 rounded-xl bg-amber-500/15 px-3 py-1.5 text-[12.5px] font-semibold text-amber-200 ring-1 ring-amber-400/25">
          <Lock size={14} className="shrink-0" /><span className="flex-1 truncate">{locked} new {locked === 1 ? 'match is' : 'matches are'} waiting. Top up from ₹100.</span><ChevronRight size={15} />
        </Link>
      )}
      {hasSubjects && (
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none]" style={{ touchAction: 'pan-x' }} role="group" aria-label={kind === 'hotlist' ? 'Profile' : 'Job'}>
          <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'} className={`${glassChip(filter === 'all')} px-3 py-1`}>
            All <span className="font-bold tabular-nums opacity-70">{totalNew}</span>
          </button>
          {data!.subjects.map((sub) => (
            <button key={sub.id} type="button" onClick={() => setFilter(sub.id)} aria-pressed={filter === sub.id} className={`${glassChip(filter === sub.id)} max-w-[220px] py-1 pl-1 pr-3`}>
              <Initials name={subjectName(kind, sub)} id={sub.id} size={22} />
              <span className="truncate">{subjectName(kind, sub)}</span>
              <span className="font-bold tabular-nums opacity-70">{countFor(sub.id)}</span>
            </button>
          ))}
          <button type="button" onClick={() => setAdding(true)} className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[13px] font-semibold text-white/85 border border-dashed border-white/30">
            <Plus size={14} />Add
          </button>
        </div>
      )}
    </div>
  );

  // After the last card: what today added up to, and (free accounts) the
  // matches still waiting, the free days left and when the next 10 come.
  const stat = (Icon: typeof Eye, value: number, label: string, tone: string) => (
    <div className={`flex flex-col items-center gap-0.5 rounded-2xl px-2 py-2.5 ring-1 ${tone}`} style={{ animation: 'ppPop 360ms cubic-bezier(.2,.8,.2,1) 250ms both' }}>
      <Icon size={16} /><b className="text-[22px] font-extrabold tabular-nums leading-tight">{value}</b><span className="text-[11px] font-semibold opacity-80">{label}</span>
    </div>
  );
  const endScreen = (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-5 py-4 text-center">
      <Confetti />
      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-emerald-600 shadow-[0_0_0_8px_rgba(16,185,129,.18)]" style={{ animation: 'ppPop 420ms cubic-bezier(.2,.8,.2,1) both' }}><Check size={32} strokeWidth={3} /></span>
      <div style={{ animation: 'ppFadeUp 400ms ease-out 120ms both' }}>
        <h2 className="text-[26px] font-extrabold leading-tight">{free && (reel?.new_today ?? 0) >= (reel?.free_daily ?? 10) ? "That's today's 10" : 'Reel complete'}</h2>
        <p className="mt-0.5 text-[13.5px] text-white/70">{filter !== 'all' && subjects[filter] ? `You watched every match for ${subjectName(kind, subjects[filter])}.` : free ? 'You watched every match for today.' : 'You watched every new match.'}</p>
      </div>
      <div className="grid w-full max-w-xs grid-cols-3 gap-2">
        {stat(Eye, watchedToday, 'watched', 'bg-white/[0.07] text-white ring-white/10')}
        {stat(Send, appliedToday, 'applied', 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/20')}
        {stat(Flame, Math.max(1, reel?.streak ?? 1), 'day streak', 'bg-orange-500/15 text-orange-200 ring-orange-400/20')}
      </div>
      {free && (reel?.waiting ?? 0) > 0 ? (
        <div className="w-full max-w-sm space-y-3 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10" style={{ animation: 'ppFadeUp 450ms ease-out 450ms both' }}>
          <p className="text-[16px] font-extrabold">{reel!.waiting} more {reel!.waiting === 1 ? 'match is' : 'matches are'} waiting</p>
          <div className="relative space-y-2">
            {reel!.waiting_preview.map((w, k) => (
              <div key={k} className="flex items-center gap-2.5 rounded-2xl bg-white/[0.07] p-2.5 text-left">
                <CompanyLogo name={w.company || w.title} avatar={w.avatar} size={36} round={Boolean(w.avatar)} />
                <div className="min-w-0 flex-1 select-none blur-[5px]" aria-hidden="true"><b className="block truncate text-[14px]">{w.title}</b><small className="block truncate text-[12px] text-white/70">{w.company}</small></div>
                <FitRing value={w.fit ?? 80} size={40} onDark />
              </div>
            ))}
            <span className="absolute inset-0 grid place-items-center"><span className="grid h-11 w-11 place-items-center rounded-full bg-black/60 ring-1 ring-white/20"><Lock size={18} /></span></span>
          </div>
          <Link to="/billing" onClick={() => trackEvent('reel_unlock_clicked', { waiting: reel!.waiting })}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-600 text-[15px] font-extrabold shadow-[0_8px_24px_rgba(99,102,241,.45)]">
            <Sparkles size={17} />Unlock them · from ₹100
          </Link>
          <p className="text-[12.5px] text-white/60">Or wait {countdown} for tomorrow&apos;s 10</p>
        </div>
      ) : free ? (
        <div className="w-full max-w-sm space-y-2 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10" style={{ animation: 'ppFadeUp 450ms ease-out 450ms both' }}>
          <p className="text-[14px] font-bold">Free plan: 10 new matches a day. Next 10 in {countdown}.</p>
          <Link to="/billing" className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-600 text-[14px] font-extrabold"><Sparkles size={16} />Get up to 100 a day</Link>
        </div>
      ) : (
        <p className="text-[13.5px] text-white/70">New matches arrive every 10 minutes.</p>
      )}
      {free && reel && (
        <p className="text-[12px] text-white/50">{Math.floor(reel.credits)} free matches left, about {Math.max(1, Math.ceil(reel.credits / (reel.free_daily || 10)))} {Math.ceil(reel.credits / (reel.free_daily || 10)) === 1 ? 'day' : 'days'}</p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Link to="/history" className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2.5 text-[14px] font-bold"><History size={16} />History</Link>
        <Link to="/match" className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2.5 text-[14px] font-bold"><Sparkles size={16} />Run AI Match</Link>
      </div>
    </div>
  );

  const emptyFirst = (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center dark:border-white/10 dark:bg-[#20242a]">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/15"><Plus size={26} /></span>
      <h3 className="text-[18px] font-extrabold">{kind === 'hotlist' ? 'Add your first profile' : 'Post your first job'}</h3>
      <p className="max-w-[32ch] text-[13.5px] text-gray-600 dark:text-slate-400">{kind === 'hotlist' ? 'Upload a resume or paste a hotlist line. Matching jobs start arriving here in about 10 minutes.' : 'Paste the job. Matching profiles start arriving here in about 10 minutes.'}</p>
      <button type="button" onClick={() => setAdding(true)} className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-blue-600 px-4 text-[14px] font-bold text-white"><Plus size={16} />{kind === 'hotlist' ? 'Add profile' : 'Add job'}</button>
    </div>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f3f2ee] pb-[calc(4.25rem+env(safe-area-inset-bottom))] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100 sm:pb-0">
      <AppNav immersive={immersive} chromeVisible={false} />

      {immersive ? (
        loading && !data ? (
          <div className="fixed inset-0 z-[60] grid place-items-center bg-[#0b0f1a]"><LogoSpinner size={22} /></div>
        ) : (
          <SwipeDeck
            key={deckKey}
            {...deckProps}
            top={topBar}
            layer="z-[60]"
            boxes={tall}
            reelMs={REEL_MS}
            endScreen={endScreen}
            paused={Boolean(openId || profileId || adding || searchFocused || actions.ai.preview)}
            startId={deckId}
            focusId={deckFocus}
            onCurrent={(i) => { setDeckId(i?.card_id ?? null); actions.checkFrame(i); }}
            onCollapse={() => { setFull(false); trackEvent('today_full_screen_closed'); }}
          />
        )
      ) : (
        <div className="mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 grid-cols-[minmax(0,1fr)] gap-4 px-2.5 pb-2 pt-2 sm:p-4 lg:grid-cols-[470px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-2">
            {loading && !data ? (
              <div className="flex flex-1 justify-center py-16"><LogoSpinner size={20} /></div>
            ) : loadError ? (
              <p className="rounded-2xl bg-white p-6 text-center text-[13px] text-red-600 dark:bg-[#20242a]">{loadError}</p>
            ) : !hasSubjects ? emptyFirst : (
              <div className="min-h-0 flex-1">
                <SwipeDeck
                  key={deckKey}
                  {...deckProps}
                  inline
                  hideDetails={wide}
                  boxes={wide}
                  top={topBar}
                  endScreen={endScreen}
                  reelMs={wide ? undefined : REEL_MS}
                  paused={Boolean(openId || profileId || adding || searchFocused || actions.ai.preview)}
                  startId={deckId}
                  focusId={deckFocus}
                  onCurrent={(i) => { setDeckId(i?.card_id ?? null); actions.checkFrame(i); }}
                  onExpand={wide ? undefined : () => { setFull(true); trackEvent('today_full_screen'); }}
                  onStep={wide ? undefined : (_d, toId) => { setDeckId(toId); setFull(true); }}
                />
              </div>
            )}
          </div>

          {wide && hasSubjects && (
            <div className="min-h-0 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#20242a]">
              {current ? detailFor(current, 'pane') : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-gray-400">
                  <b className="text-[16px] text-gray-700 dark:text-slate-200">{items.length === 0 ? 'All caught up' : 'Pick a match'}</b>
                  <p className="max-w-[34ch] text-[13px]">Why it fits, the post, and your application show here.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
        <div className="fixed inset-0 z-[85] pt-[env(safe-area-inset-top)] animate-[ppSheetIn_.22s_ease-out]" role="dialog" aria-label="Profile">
          <ProfileSheet subject={profileSubject} kind={kind} newCount={countFor(profileSubject.id)} accountId={accountId} mode="sheet"
            onClose={() => setProfileId(null)} onSeeMatches={() => { setFilter(profileSubject.id); setProfileId(null); setOpenId(null); }} onChanged={() => void load()} showToast={(m) => showToast(m)} />
        </div>
      ))}

      {actions.frame && (
        <ApplyFrame item={actions.frame.item} url={actions.frame.url} kind={kind} subject={subjects[actions.frame.item.subject_id]} onClose={() => actions.setFrame(null)} />
      )}
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
