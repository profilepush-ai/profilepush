import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronRight, Eye, Flame, History, Lock, Plus, Search, Send, Sparkles, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import PostFormModal from '../components/posts/PostFormModal';
import { AiSubmitDialog } from '../components/AiSubmit';
import MatchDetail from '../components/match/MatchDetail';
import SwipeDeck from '../components/match/SwipeDeck';
import ProfileSheet from '../components/match/ProfileSheet';
import { CompanyLogo, FitRing } from '../components/match/Visuals';
import ToastBar from '../components/match/ToastBar';
import ApplyFrame from '../components/match/ApplyFrame';
import { loadAvatar } from '../lib/avatar';
import { supabase } from '../lib/supabase';
import { useMatchActions } from '../components/match/useMatchActions';
import { useSwipe } from '../components/match/useSwipe';
import { useAuth } from '../contexts/AuthContext';
import { trackEvent } from '../lib/track';
import { cardRoute, loadToday, markViewed, strings, subjectName, timeLeft, type CardItem, type Kind, type Question, type Subject, type TodayData } from '../lib/today';
import { priceLabels, useCurrency } from '../lib/currency';
import { maybeAskForPlayReview } from '../lib/rate';
import ProfileStories from '../components/match/ProfileStories';

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
// The end of a reel they applied from: a good moment for Google Play's own
// rating dialog (at most every 60 days; Google decides if it shows).
function AskForRating({ when }: { when: boolean }) {
  useEffect(() => { if (when) maybeAskForPlayReview('reel_complete'); }, [when]);
  return null;
}

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
  const [currencyNow] = useCurrency();
  const price = priceLabels(currencyNow);
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
  // Whether they've made an avatar (the end screen offers it until they do).
  const [hasAvatar, setHasAvatar] = useState(true);
  useEffect(() => { loadAvatar().then((a) => setHasAvatar(Boolean(a.avatar?.url))).catch(() => {}); }, []);

  // What they'd already seen when this visit began: those cards go after the
  // rest, so Today opens on the first match not seen yet and anything new
  // comes first. Fixed for the visit, so the deck never reshuffles mid-swipe.
  const [seenAtStart, setSeenAtStart] = useState<Set<string> | null>(null);
  const load = useCallback(async () => {
    try {
      const d = await loadToday(kind);
      setData(d);
      if (d) setSeenAtStart((prev) => prev ?? new Set(d.items.filter((i) => i.viewed_at).map((i) => i.card_id)));
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
  const items = useMemo(() => {
    const list = (data?.items ?? []).filter((i) => i.lead && (filter === 'all' || i.subject_id === filter) && matchesSearch(i, words));
    if (!seenAtStart) return list;
    return [...list.filter((i) => !seenAtStart.has(i.card_id)), ...list.filter((i) => seenAtStart.has(i.card_id))];
  }, [data?.items, filter, words, seenAtStart]);
  // Where to open: the first match not seen yet, else the last one they were on.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !seenAtStart || !data) return;
    opened.current = true;
    let last: string | null = null;
    try { last = sessionStorage.getItem(`pp_today_at_${kind}`); } catch { /* fine */ }
    const first = items.find((i) => !seenAtStart.has(i.card_id)) ?? items.find((i) => i.card_id === last) ?? null;
    if (first && first.card_id !== items[0]?.card_id) { setDeckId(first.card_id); setDeckFocus(first.card_id); }
  }, [seenAtStart, data, items, kind]);
  useEffect(() => { if (deckId) try { sessionStorage.setItem(`pp_today_at_${kind}`, deckId); } catch { /* fine */ } }, [deckId, kind]);
  // Each profile's matches today for its status ring: leaving within 3
  // hours (red), new (green) and watched (grey).
  const storyCounts = (id: string) => {
    const list = (data?.items ?? []).filter((i) => i.lead && (id === 'all' || i.subject_id === id));
    const expiring = list.filter((i) => timeLeft(i)?.urgent).length;
    const fresh = list.filter((i) => !i.viewed_at && !timeLeft(i)?.urgent).length;
    return { total: list.length, expiring, fresh, seen: list.length - expiring - fresh };
  };
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
    // A free preview opens Billing: its details come with a top-up.
    if (item.teaser) { navigate('/billing'); return; }
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

  // A reported picture goes away for them now, and is drawn again.
  const reportPicture = (item: CardItem, url: string) => {
    void supabase.rpc('report_match_visual' as never, { p_lead: item.lead_id, p_url: url } as never);
    setData((d) => d && { ...d, items: d.items.map((i) => (i.lead_id === item.lead_id ? { ...i, my_visual: null, lead: i.lead && { ...i.lead, visuals: null } } : i)) });
    actions.showToast("Thanks for telling us. We'll draw a new picture.");
    trackEvent('picture_reported');
  };

  // ?profile=<id> opens that profile (from History and Settings).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get('profile');
    if (id && subjects[id]) { setProfileId(id); params.delete('profile'); setParams(params, { replace: true }); }
  }, [params, subjects, setParams]);

  // Pushes and emails link to /today?card=<card id> (or ?lead=<post id>):
  // open the reel at that match, or go where it moved to (Tracker, History,
  // or the post itself) once it has left Today.
  const navigate = useNavigate();
  useEffect(() => {
    const card = params.get('card');
    const lead = params.get('lead');
    if ((!card && !lead) || !data) return;
    params.delete('card'); params.delete('lead');
    setParams(params, { replace: true });
    const hit = data.items.find((i) => i.lead && (card ? i.card_id === card : i.lead_id === lead));
    if (hit) {
      setFilter('all'); setQuery(''); setFull(true);
      setDeckId(hit.card_id); setDeckFocus(hit.card_id);
      trackEvent('today_deep_link', { found: true });
      return;
    }
    trackEvent('today_deep_link', { found: false });
    void cardRoute(card, lead).then((to) => { if (to !== '/today') navigate(to, { replace: true }); });
  }, [params, data, setParams, navigate]);

  // AI Match sends people here with ?for=<profile or job>: its new matches,
  // full screen, from the first.
  useEffect(() => {
    const id = params.get('for');
    if (!id || !data) return;
    params.delete('for');
    setParams(params, { replace: true });
    const first = data.items.find((i) => i.lead && i.subject_id === id);
    setFilter(id); setQuery(''); setFull(true);
    if (first) { setDeckId(first.card_id); setDeckFocus(first.card_id); }
    trackEvent('today_from_ai_match', { found: Boolean(first) });
  }, [params, data, setParams]);

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
    items, kind, subjects, appliedToday, emptyMessage, expiring: true, viewerId: user?.id, teaserSince: data?.teasers?.since ?? null,
    onSeen: see, onApply: applyQuick, onSave: save, onShare: (i: CardItem) => void share(i), onDismiss: dismiss,
    onDetails: (i: CardItem) => open(i),
    asked: actions.asked, onAsk: (i: CardItem, q: Question) => void actions.ask(i, q),
    onReportPicture: reportPicture,
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

  // The search and the profile stories (the streak and today's applies live
  // on the Tracker cards and the end-of-reel screen).
  const topBar = (controls: ReactNode) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/90 pl-3.5 pr-1.5 shadow-sm ring-1 ring-gray-200 backdrop-blur focus-within:ring-blue-400">
          <Search size={16} className="shrink-0 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={totalNew ? `Search ${totalNew} matches` : 'Search matches'}
            aria-label="Search matches by job, company, skill, location or profile"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-gray-900 outline-none placeholder:text-gray-400 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-gray-500 hover:bg-black/5"><X size={15} /></button>
          )}
        </label>
        {controls}
      </div>
      {locked > 0 && (
        <Link to="/billing" className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-1.5 text-[12.5px] font-semibold text-amber-800 ring-1 ring-amber-200">
          <Lock size={14} className="shrink-0" /><span className="flex-1 truncate">{locked} new {locked === 1 ? 'match is' : 'matches are'} waiting. Top up from {price.minTopup}.</span><ChevronRight size={15} />
        </Link>
      )}
      {hasSubjects && (
        <ProfileStories kind={kind} subjects={data!.subjects} filter={filter} onFilter={setFilter} countsFor={storyCounts} onAdd={() => setAdding(true)} />
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
      <AskForRating when={appliedToday > 0} />
      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-emerald-600 text-white shadow-[0_0_0_8px_rgba(16,185,129,.18)]" style={{ animation: 'ppPop 420ms cubic-bezier(.2,.8,.2,1) both' }}><Check size={32} strokeWidth={3} /></span>
      <div style={{ animation: 'ppFadeUp 400ms ease-out 120ms both' }}>
        <h2 className="text-[26px] font-extrabold leading-tight">{free && (reel?.new_today ?? 0) >= (reel?.free_daily ?? 10) ? "That's today's 10" : 'Reel complete'}</h2>
        <p className="mt-0.5 text-[13.5px] text-gray-500">{filter !== 'all' && subjects[filter] ? `You watched every match for ${subjectName(kind, subjects[filter])}.` : free ? 'You watched every match for today.' : 'You watched every new match.'}</p>
      </div>
      <div className="grid w-full max-w-xs grid-cols-3 gap-2">
        {stat(Eye, watchedToday, 'watched', 'bg-gray-50 text-gray-900 ring-gray-200')}
        {stat(Send, appliedToday, 'applied', 'bg-emerald-50 text-emerald-700 ring-emerald-200')}
        {stat(Flame, Math.max(1, reel?.streak ?? 1), 'day streak', 'bg-orange-50 text-orange-700 ring-orange-200')}
      </div>
      {free && (reel?.waiting ?? 0) > 0 ? (
        <div className="w-full max-w-sm space-y-3 rounded-3xl bg-gray-50 p-4 ring-1 ring-gray-200" style={{ animation: 'ppFadeUp 450ms ease-out 450ms both' }}>
          <p className="text-[16px] font-extrabold">{reel!.waiting} more {reel!.waiting === 1 ? 'match is' : 'matches are'} waiting</p>
          <div className="relative space-y-2">
            {reel!.waiting_preview.map((w, k) => (
              <div key={k} className="flex items-center gap-2.5 rounded-2xl bg-white p-2.5 text-left ring-1 ring-gray-200">
                <CompanyLogo name={w.company || w.title} avatar={w.avatar} size={36} round={Boolean(w.avatar)} />
                <div className="min-w-0 flex-1 select-none blur-[5px]" aria-hidden="true"><b className="block truncate text-[14px]">{w.title}</b><small className="block truncate text-[12px] text-gray-500">{w.company}</small></div>
                <FitRing value={w.fit ?? 80} size={40} />
              </div>
            ))}
            <span className="absolute inset-0 grid place-items-center"><span className="grid h-11 w-11 place-items-center rounded-full bg-gray-900 text-white"><Lock size={18} /></span></span>
          </div>
          <Link to="/billing" onClick={() => trackEvent('reel_unlock_clicked', { waiting: reel!.waiting })}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-600 text-[15px] font-extrabold text-white shadow-[0_8px_24px_rgba(99,102,241,.35)]">
            <Sparkles size={17} />Unlock them · from {price.minTopup}
          </Link>
          <p className="text-[12.5px] text-gray-500">Or wait {countdown} for tomorrow&apos;s 10</p>
        </div>
      ) : free ? (
        <div className="w-full max-w-sm space-y-2 rounded-3xl bg-gray-50 p-4 ring-1 ring-gray-200" style={{ animation: 'ppFadeUp 450ms ease-out 450ms both' }}>
          <p className="text-[14px] font-bold">{data?.teasers?.paused
            ? 'Your free matches are paused. Top up to start them again.'
            : data?.teasers?.since
              ? `Your free credits are used: 10 previews a day, title and match score only. Next 10 in ${countdown}.`
              : `Free plan: 10 new matches a day. Next 10 in ${countdown}.`}</p>
          <Link to="/billing" className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-600 text-[14px] font-extrabold text-white"><Sparkles size={16} />Get up to 100 a day</Link>
        </div>
      ) : (
        <p className="text-[13.5px] text-gray-500">New matches arrive every 10 minutes.</p>
      )}
      {free && reel && (
        <p className="text-[12px] text-gray-500">{Math.floor(reel.credits)} free matches left, about {Math.max(1, Math.ceil(reel.credits / (reel.free_daily || 10)))} {Math.ceil(reel.credits / (reel.free_daily || 10)) === 1 ? 'day' : 'days'}</p>
      )}
      {kind === 'hotlist' && !hasAvatar && (
        <Link to="/settings#avatar" onClick={() => trackEvent('avatar_nudge_clicked')} className="flex w-full max-w-sm items-center gap-3 rounded-2xl bg-gray-50 p-3 text-left ring-1 ring-gray-200">
          <Sparkles size={20} className="shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1"><b className="block text-[14px]">Get your 3D avatar</b><small className="block text-[12px] text-gray-500">Your profile photo, made from your photo. Free.</small></span>
          <ChevronRight size={16} className="shrink-0" />
        </Link>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Link to="/history" className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-2.5 text-[14px] font-bold text-gray-800"><History size={16} />History</Link>
        <Link to="/match" className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-2.5 text-[14px] font-bold text-gray-800"><Sparkles size={16} />Run AI Match</Link>
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
          <div className="fixed inset-0 z-[60] grid place-items-center bg-white"><LogoSpinner size={22} /></div>
        ) : (
          <SwipeDeck
            key={deckKey}
            {...deckProps}
            top={topBar}
            // Above the bottom menu, which stays on a phone.
            layer="z-[60] bottom-[calc(4.25rem+env(safe-area-inset-bottom))]"
            navBelow
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
                  hideAsk={wide}
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
            <ProfileSheet subject={profileSubject} kind={kind} newCount={storyCounts(profileSubject.id).total} accountId={accountId} mode="drawer"
              onClose={() => setProfileId(null)} onSeeMatches={() => { setFilter(profileSubject.id); setProfileId(null); }} onChanged={() => void load()} showToast={(m) => showToast(m)} />
          </div>
        </>
      ) : (
        <div className="fixed inset-0 z-[85] pt-[env(safe-area-inset-top)] animate-[ppSheetIn_.22s_ease-out]" role="dialog" aria-label="Profile">
          <ProfileSheet subject={profileSubject} kind={kind} newCount={storyCounts(profileSubject.id).total} accountId={accountId} mode="sheet"
            onClose={() => setProfileId(null)} onSeeMatches={() => { setFilter(profileSubject.id); setProfileId(null); setOpenId(null); }} onChanged={() => void load()} showToast={(m) => showToast(m)} />
        </div>
      ))}

      {actions.frame && (
        <ApplyFrame item={actions.frame.item} url={actions.frame.url} embed={actions.frame.embed} kind={kind} subject={subjects[actions.frame.item.subject_id]} onClose={() => actions.setFrame(null)} />
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
