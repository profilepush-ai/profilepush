import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Check, ChevronDown, ChevronUp, ExternalLink, FileText, History, Maximize2, Pause, Play, Flag, Info, Lock, Send, Share2, Sparkles, Timer, X } from 'lucide-react';
import { priceLabels, useCurrency } from '../../lib/currency';
import { agoLabel, hashColor } from '../../lib/match-fit';
import { fitFor, leadOrg, leadTitle, missingFor, pictureFor, subjectName, timeLeft, type CardItem, type Kind, type Question, type Subject } from '../../lib/today';
import { AskChips, CompanyLogo, EngagementRow, FitBadges, FitLine, Initials, RateBar, SkillTiles, UsMap } from './Visuals';
import { usePictureColors } from './usePictureColors';

// When each section of a card arrives (ms). Sections move as one block (many
// small animations at once stutter on phones); inside, only the match ring
// counts, the route draws and the rate marker slides. In the reel sections
// arrive one to three seconds apart, about 15 seconds a card; elsewhere fast.
const SLOW = { title: 250, ring: 1500, ask: 2800, skills: 4000, map: 6500, rate: 8500, eng: 10500 };
const FAST = { title: 60, ring: 150, ask: 220, skills: 300, map: 420, rate: 520, eng: 650 };
const section = (at: number) => ({ animation: `ppSection 450ms cubic-bezier(.2,.8,.2,1) ${at}ms both`, willChange: 'transform, opacity' });

// Swipe mode: one match per screen, stories style. Swipe or tap the sides to
// move; the rail on the right is Apply, Save, Share and Pass. On a phone it is
// Today itself, full screen, with the search and chips in `top`; swiping up or
// down there is passed on (Today uses it to show its menus). On desktop it
// sits in the page beside the detail.
// The time a Today match has left, ticking each second (its own component,
// so only it redraws).
function TimeLeft({ item }: { item: CardItem }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = timeLeft(item, now);
  if (!left) return null;
  return (
    <span title="Today's matches leave after 24 hours. Save it to keep it." className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-bold tabular-nums ${left.urgent ? 'bg-rose-500 text-white' : 'bg-black/5 text-gray-700'}`}>
      <Timer size={12} />{left.label}
    </span>
  );
}

export default function SwipeDeck({
  items, kind, subjects, startId, focusId, appliedToday, inline = false, hideDetails = false, paused = false, emptyMessage,
  top, layer = 'z-[80]', boxes = true, menuHint = false, reelMs, endScreen, expiring = false, viewerId, avatarOn = false, teaserSince = null, asked, onAsk, onClose, onCollapse, onExpand, onCurrent, onStep, onSwipeUp, onSwipeDown, onTouch,
  onSeen, onApply, onSave, onShare, onDismiss, onDetails, onReportPicture,
}: {
  items: CardItem[]; kind: Kind; subjects: Record<string, Subject>; startId: string | null; focusId?: string | null; appliedToday: number;
  inline?: boolean; hideDetails?: boolean; paused?: boolean; emptyMessage?: { title: string; text: string };
  /** Above the card. As a function it also gets the deck's pause and ⌄ buttons, to place in its own row. */
  top?: ReactNode | ((controls: ReactNode) => ReactNode); layer?: string; boxes?: boolean; menuHint?: boolean;
  /** Picks which version of a post's picture this viewer sees. */
  viewerId?: string;
  /** Show the viewer's own avatar pictures (they have credits or a plan). */
  avatarOn?: boolean;
  /** A free account's previews began (for the days left on a teaser). */
  teaserSince?: string | null;
  /** Plays like a reel: each card moves on after this long (hold to pause). */
  reelMs?: number;
  /** Shown after the last card, instead of the plain "All caught up". */
  endScreen?: ReactNode;
  /** Today's cards: show how long each has left before it leaves Today. */
  expiring?: boolean;
  /** Ask the poster for what the post leaves out. */
  asked?: Record<string, Question[]>; onAsk?: (item: CardItem, q: Question) => void;
  onClose?: () => void; onCurrent?: (item: CardItem | null) => void; onStep?: (d: 1 | -1, toId: string | null) => void;
  /** Full screen: back to the normal page. In the page: go full screen. */
  onCollapse?: () => void; onExpand?: () => void;
  onSwipeUp?: () => void; onSwipeDown?: () => void; onTouch?: () => void;
  onSeen: (item: CardItem) => void; onApply: (item: CardItem) => void; onSave: (item: CardItem) => void;
  onShare: (item: CardItem) => void; onDismiss: (item: CardItem) => void; onDetails: (item: CardItem) => void;
  /** "Report this picture" on a card's AI picture. */
  onReportPicture?: (item: CardItem, url: string) => void;
}) {
  const [currentId, setCurrentId] = useState<string | null>(startId ?? items[0]?.card_id ?? null);
  const [dir, setDir] = useState<'n' | 'p' | null>('n');
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  // The card follows the finger while it's dragged sideways, then flies off.
  const cardRef = useRef<HTMLDivElement | null>(null);
  // A big stamp after Apply, Save or Pass, so the action is unmistakable.
  const [stamp, setStamp] = useState<{ text: string; color: string; n: number } | null>(null);
  // Reel playback: on unless turned off; holding a finger down pauses it.
  const [playing, setPlaying] = useState(() => { try { return localStorage.getItem('reel_autoplay') !== '0'; } catch { return true; } });
  const [held, setHeld] = useState(false);
  // The AI picture note, open for this card.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [currencyNow] = useCurrency();
  const price = priceLabels(currencyNow);
  const running = Boolean(reelMs) && playing && !held && !paused && !noteFor;
  const togglePlay = () => setPlaying((p) => { try { localStorage.setItem('reel_autoplay', p ? '0' : '1'); } catch { /* fine */ } return !p; });
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (text: string, color: string) => {
    setStamp((p) => ({ text, color, n: (p?.n ?? 0) + 1 }));
    if (stampTimer.current) clearTimeout(stampTimer.current);
    stampTimer.current = setTimeout(() => setStamp(null), 900);
  };
  useEffect(() => () => { if (stampTimer.current) clearTimeout(stampTimer.current); }, []);
  // Past the last card: the end screen stays until the user goes back.
  const [ended, setEnded] = useState(false);
  const index = ended ? -1 : items.findIndex((i) => i.card_id === currentId);
  // Back from the detail view: show the card it ended on.
  useEffect(() => {
    if (focusId && focusId !== currentId && items.some((i) => i.card_id === focusId)) { setCurrentId(focusId); setDir(null); }
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = !ended && index >= 0 ? items[index] : null;

  // When the current card leaves (applied, saved, passed), show the one after it.
  const lastIndex = useRef(0);
  useEffect(() => {
    if (index >= 0) { lastIndex.current = index; return; }
    if (ended) return;
    const next = items[Math.min(lastIndex.current, items.length - 1)];
    setCurrentId(next?.card_id ?? null);
    setDir('n');
  }, [index, items, ended]);

  useEffect(() => { if (item) onSeen(item); onCurrent?.(item); }, [item?.card_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (d: 1 | -1) => {
    if (ended) {
      if (d === -1 && items.length) { setEnded(false); setCurrentId(items[items.length - 1].card_id); setDir('p'); }
      return;
    }
    const j = index + d;
    if (index < 0 || j < 0) return;
    if (j >= items.length) { setEnded(true); setCurrentId(null); onStep?.(d, null); return; }
    setCurrentId(items[j].card_id);
    setDir(d > 0 ? 'n' : 'p');
    onStep?.(d, items[j].card_id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused) return;
      // Not while typing (the application email sits beside the deck on desktop).
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The sharp picture starts below the profile row (search and chips sit on
  // the blurred one); this is where that row ends, kept up to date.
  const forRowRef = useRef<HTMLDivElement | null>(null);
  const currentPicture = item?.lead ? (avatarOn ? item.my_visual : null) || pictureFor(item.lead, viewerId) : null;
  const [picTop, setPicTop] = useState(0);
  useLayoutEffect(() => {
    const row = forRowRef.current;
    if (!row) return undefined;
    const measure = () => setPicTop(row.offsetTop + row.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    if (row.offsetParent) ro.observe(row.offsetParent);
    return () => ro.disconnect();
  });

  const tones = usePictureColors(currentPicture);

  // The next two pictures load ahead, so a swipe never waits for one.
  useEffect(() => {
    if (index < 0) return;
    for (const next of items.slice(index + 1, index + 3)) {
      const url = (avatarOn ? next.my_visual : null) || (next.lead ? pictureFor(next.lead, viewerId) : null);
      if (url) new Image().src = url;
    }
  }, [index, items, viewerId, avatarOn]);

  const shell = inline
    ? 'relative flex h-full min-h-0 select-none flex-col overflow-hidden rounded-[22px] bg-white text-gray-900 ring-1 ring-gray-200'
    : `fixed inset-0 ${layer} flex select-none flex-col overflow-hidden bg-white pt-[env(safe-area-inset-top)] text-gray-900`;
  const settle = (el: HTMLDivElement | null) => {
    if (!el) return;
    el.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1), opacity .25s';
    el.style.transform = '';
    el.style.opacity = '';
  };
  const corner = inline || !onClose
    ? null
    : <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full text-gray-600 hover:bg-black/5"><X size={22} /></button>;
  const sizeButton = onCollapse || onExpand ? (
    <span data-rail>
      <button type="button" onClick={onCollapse ?? onExpand} aria-label={onCollapse ? 'Close full screen' : 'Full screen'} title={onCollapse ? 'Close full screen' : 'Full screen'}
        className="grid h-9 w-9 place-items-center rounded-full bg-white/80 text-gray-700 shadow-sm ring-1 ring-black/5 backdrop-blur hover:bg-white">
        {onCollapse ? <ChevronDown size={20} /> : <Maximize2 size={16} />}
      </button>
    </span>
  ) : null;
  const playButton = reelMs && item ? (
    <span data-rail>
      <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (or hold the card)' : 'Play'}
        className="grid h-9 w-9 place-items-center rounded-full bg-white/80 text-gray-700 shadow-sm ring-1 ring-black/5 backdrop-blur hover:bg-white">
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>
    </span>
  ) : null;
  // A function top takes the pause and ⌄ buttons into its own row.
  const ownControls = typeof top !== 'function';
  const topSlot = top
    ? <div data-rail className="relative z-30 px-3 pt-2.5">{typeof top === 'function' ? top(<>{playButton}{sizeButton}</>) : top}</div>
    : null;
  // Vertical swipes go to the page (menus); sideways ones move the deck.
  const gestures = {
    style: { touchAction: inline ? 'pan-y' : 'none' } as const,
    onPointerDown: (e: ReactPointerEvent) => {
      onTouch?.();
      start.current = (e.target as HTMLElement).closest('[data-rail]') ? null : { x: e.clientX, y: e.clientY };
      if (start.current) setHeld(true);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const s = start.current;
      const el = cardRef.current;
      if (!s || !el) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
      el.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 500));
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = start.current;
      start.current = null;
      setHeld(false);
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      const el = cardRef.current;
      if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        swiped.current = true;
        settle(el);
        if (dy < 0) onSwipeUp?.(); else onSwipeDown?.();
        return;
      }
      const d: 1 | -1 = dx < 0 ? 1 : -1;
      if (Math.abs(dx) > 50 && !(d === -1 && index <= 0)) {
        swiped.current = true;
        if (el) {
          el.style.transition = 'transform .18s ease-in, opacity .18s ease-in';
          el.style.transform = `translateX(${dx < 0 ? -130 : 130}%) rotate(${dx < 0 ? -14 : 14}deg)`;
          el.style.opacity = '0';
        }
        setTimeout(() => step(d), 150);
        return;
      }
      settle(el);
    },
    onPointerCancel: () => { start.current = null; setHeld(false); settle(cardRef.current); },
  };
  const stampEl = stamp ? (
    <span key={stamp.n} aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[46%] z-40 rounded-2xl border-[5px] px-5 py-1.5 text-[34px] font-black tracking-[0.12em]"
      style={{ color: stamp.color, borderColor: stamp.color, background: 'rgba(255,255,255,.8)', animation: 'ppActionStamp 900ms ease-out both' }}>
      {stamp.text}
    </span>
  ) : null;
  // The home-bar handle: swipe up from here for the menus.
  const handle = onSwipeUp ? <span aria-hidden="true" className="pointer-events-none absolute bottom-[calc(6px+env(safe-area-inset-bottom))] left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-gray-300" /> : null;

  if (!item || !item.lead) {
    return (
      <div className={`${shell} pp-anim`} role={inline || !onClose ? 'region' : 'dialog'} aria-label="All caught up" {...gestures}>
        <div className="pointer-events-none absolute -left-1/3 -right-1/3 -top-1/4 h-3/4 opacity-60" style={{ background: 'radial-gradient(closest-side, #10b981, transparent)' }} />
        {topSlot}
        {corner && <div className="relative z-10 flex justify-end p-2">{corner}</div>}
        {sizeButton && ownControls && <div className="relative z-30 flex justify-end px-3 pt-2">{sizeButton}</div>}
        {endScreen && !emptyMessage ? <div className="relative z-10 flex min-h-0 flex-1 flex-col">{endScreen}</div> : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-emerald-600"><Check size={36} strokeWidth={3} /></span>
          <h2 className="text-[26px] font-extrabold">{emptyMessage?.title ?? 'All caught up'}</h2>
          <p className="max-w-[28ch] text-gray-600">{emptyMessage?.text ?? `${appliedToday} applied today. New matches arrive every 10 minutes.`}</p>
          {inline || !onClose ? (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Link to="/history" className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-2.5 font-bold text-gray-800"><History size={16} />History</Link>
              <Link to="/match" className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2.5 font-bold"><Sparkles size={16} />Run AI Match</Link>
            </div>
          ) : (
            <button type="button" onClick={onClose} className="mt-2 rounded-full bg-gray-100 px-5 py-2.5 font-bold text-gray-800">Back to Today</button>
          )}
        </div>
        )}
        {stampEl}
        {handle}
      </div>
    );
  }

  const lead = item.lead;
  const subject = subjects[item.subject_id];
  const fit = fitFor(kind, subject, lead);
  const site = kind === 'hotlist' && lead.source === 'career_site';
  const picture = (avatarOn ? item.my_visual : null) || pictureFor(lead, viewerId);
  const previewDays = teaserSince ? Math.max(0, 7 - Math.floor((Date.now() - new Date(teaserSince).getTime()) / 86_400_000)) : null;
  const color = hashColor(item.subject_id);
  const name = subjectName(kind, subject);
  const saved = Boolean(item.saved_at);
  const T = reelMs ? SLOW : FAST;
  const rail = 'flex flex-col items-center gap-1 text-[11px] font-bold';
  const railIcon = 'grid h-[46px] w-[46px] place-items-center rounded-full bg-white text-gray-700 shadow-md ring-1 ring-black/5';

  return (
    <div
      className={`${shell} pp-anim`}
      role={inline || !onClose ? 'region' : 'dialog'}
      aria-label="Swipe through matches"
      {...gestures}
    >
      {picture ? (
        // The post's AI picture: sharp from below the profile row to about the
        // middle, on a smooth gradient of its own colors behind everything
        // else (the search and chips above it, the details below).
        <div key={picture} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" style={{ animation: 'ppPicture .5s ease-out both' }}>
          {/* A smooth gradient of the picture's own colors, darkened. */}
          {tones && <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${tones[0]} 0%, ${tones[1]} 45%, ${tones[2]} 100%)` }} />}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,.45) 30%, rgba(255,255,255,.9) 56%, #fff 78%)' }} />
          <img src={picture} alt="" decoding="async" className="absolute inset-x-0 w-full object-cover object-[50%_22%]"
            style={{ top: picTop, height: `max(160px, calc(56% - ${picTop}px))`, maskImage: 'linear-gradient(180deg, transparent, #000 16%, #000 60%, transparent)', WebkitMaskImage: 'linear-gradient(180deg, transparent, #000 16%, #000 60%, transparent)' }} />
        </div>
      ) : (
        <div className="pointer-events-none absolute -left-1/3 -right-1/3 -top-1/4 h-3/4 opacity-60" style={{ background: `radial-gradient(closest-side, ${hashColor(leadOrg(lead))}, transparent)` }} />
      )}
      <div className="relative z-20 flex gap-[3px] px-2.5 pt-2.5" aria-hidden="true">
        {(() => {
          const from = Math.max(0, Math.min(index - 10, items.length - 40));
          return items.slice(from, from + 40).map((x, n) => {
            const k = from + n;
            return (
              <i key={x.card_id} className="relative h-[3px] flex-1 overflow-hidden rounded-sm bg-black/10">
                {(k < index || (k === index && !reelMs)) && <b className="absolute inset-0 bg-gray-900" />}
                {k === index && reelMs && (
                  <b key={item.card_id} className="absolute inset-y-0 left-0 bg-gray-900"
                    style={{ animation: `ppReel ${reelMs}ms linear both`, animationPlayState: running ? 'running' : 'paused' }}
                    onAnimationEnd={(e) => { if (e.animationName === 'ppReel') step(1); }} />
                )}
              </i>
            );
          });
        })()}
      </div>
      {topSlot}
      <div ref={forRowRef} className="relative z-20 flex items-center gap-2.5 py-2.5 pl-3 pr-2">
        <Initials name={name} id={item.subject_id} size={32} />
        <div className="min-w-0 flex-1"><b className="block truncate text-[14px]">for {name}</b><small className="block truncate text-[11.5px] text-gray-500">{kind === 'hotlist' ? subject?.title : 'Your job'}</small></div>
        {picture && (
          <span data-rail className="relative">
            <button type="button" onClick={() => setNoteFor(noteFor === item.card_id ? null : item.card_id)} aria-expanded={noteFor === item.card_id}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-white/85 px-2.5 text-[11.5px] font-semibold text-gray-700 shadow-sm ring-1 ring-black/5 backdrop-blur hover:bg-white">
              <Info size={13} />AI picture
            </button>
            {noteFor === item.card_id && (
              <span role="dialog" aria-label="About this picture" className="absolute right-0 top-9 z-50 block w-[270px] rounded-2xl bg-white p-3.5 text-left text-[12.5px] leading-snug text-gray-700 shadow-2xl dark:bg-[#20242a] dark:text-slate-200">
                <b className="mb-1 block text-[13.5px] text-gray-900 dark:text-white">An AI illustration</b>
                Made by AI to picture this role. It isn&apos;t a real person, and it&apos;s never chosen from anyone&apos;s name or background. ProfilePush stands against racism and discrimination of any kind. If a picture feels wrong, tell us and we&apos;ll draw a new one.
                {onReportPicture && (
                  <button type="button" onClick={() => { onReportPicture(item, picture); setNoteFor(null); }}
                    className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-gray-100 text-[13px] font-bold text-gray-800 hover:bg-gray-200 dark:bg-white/10 dark:text-white">
                    <Flag size={14} />Report this picture
                  </button>
                )}
              </span>
            )}
          </span>
        )}
        {ownControls && playButton}
        {ownControls && sizeButton}
        {corner}
      </div>

      <button type="button" aria-label="Previous match" onClick={() => { if (swiped.current) { swiped.current = false; return; } step(-1); }} className="absolute bottom-[70px] left-0 top-[70px] z-10 w-[30%]" />
      <button type="button" aria-label="Next match" onClick={() => { if (swiped.current) { swiped.current = false; return; } step(1); }} className="absolute bottom-[70px] right-0 top-[70px] z-10 w-[30%]" />

      <div key={item.card_id} ref={cardRef} style={{ justifyContent: picture ? 'safe flex-end' : 'safe center' }} className={`pointer-events-none relative z-0 flex min-h-0 flex-1 flex-col justify-center gap-3.5 overflow-hidden py-1.5 pl-4 pr-20  ${dir === 'n' ? 'animate-[ppSwipeIn_.25s_ease-out]' : dir === 'p' ? 'animate-[ppSwipeBack_.25s_ease-out]' : ''}`}>
        {item.teaser ? (
          // A free preview: the title and match score; the rest unlocks with a top-up.
          <>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-700 ring-1 ring-amber-200" style={section(0)}><Lock size={13} />Free preview</span>
            <h2 className="text-balance text-[25px] font-extrabold leading-[1.15] tracking-tight" style={section(T.title)}>{leadTitle(lead)}</h2>
            <div className="-mt-1.5" style={section(T.ring)}><FitLine value={item.fit ?? Math.round(item.similarity * 100)} animate at={T.ring + 150} /></div>
            <div className="space-y-2.5 rounded-2xl border border-gray-200 bg-gray-50 p-3.5" style={section(T.skills)}>
              <div aria-hidden="true" className="space-y-2">{[78, 62, 88, 50].map((w) => <i key={w} className="block h-2.5 rounded-full bg-gray-200" style={{ width: `${w}%` }} />)}</div>
              <p className="text-[13px] font-semibold text-gray-700">The company, rate, skills and how to apply are in this match.{previewDays != null ? ` ${previewDays} ${previewDays === 1 ? 'day' : 'days'} of free previews left.` : ''}</p>
              <Link to="/billing" data-rail className="pointer-events-auto flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-600 text-[14.5px] font-extrabold text-white">
                <Lock size={15} />Top up to see it · from {price.minTopup}
              </Link>
            </div>
          </>
        ) : (<>
        <div className="flex items-center gap-2.5" style={section(0)}>
          <CompanyLogo name={leadOrg(lead)} avatar={lead.avatar} domain={lead.logo_domain} size={46} round={Boolean(lead.avatar)} />
          <div className="min-w-0 flex-1"><b className="block truncate text-[15px]">{leadOrg(lead)}</b><small className="block text-[12px] text-gray-500">{kind === 'job' ? 'Profile' : site ? 'Apply on site' : 'Apply by email'} · {agoLabel(lead.posted_at)} ago</small></div>
          {expiring && <TimeLeft item={item} />}
        </div>
        <h2 className="text-balance text-[25px] font-extrabold leading-[1.15] tracking-tight" style={section(T.title)}>{leadTitle(lead)}</h2>
        <div className="-mt-1.5" style={section(T.ring)}><FitLine value={item.fit ?? Math.round(item.similarity * 100)} animate at={T.ring + 150} /></div>
        <div style={section(T.ring)}><FitBadges fit={fit} hide={onAsk && lead.has_email ? missingFor(kind, fit) : []} /></div>
        {onAsk && lead.has_email && missingFor(kind, fit).length > 0 && (
          <div data-rail className="pointer-events-auto" style={section(T.ask)}>
            <AskChips missing={missingFor(kind, fit)} asked={asked?.[item.lead_id] ?? []} onAsk={(q) => onAsk(item, q)} />
          </div>
        )}
        <div style={section(T.skills)}><SkillTiles skills={fit.skills.slice(0, 6)} /></div>
        {/* Where there's no room (short phones, or a picture), the badges above say the same. */}
        {boxes && !picture && <div className="grid grid-cols-2 gap-2.5">
          <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-gray-200 bg-gray-50 p-2.5" style={section(T.map)}>
            <UsMap jobState={fit.location.jobState} profileState={fit.location.profileState} remote={fit.location.kind === 'remote'} profileColor={color} animate wave={false} at={T.map - 300} />
            <p className="truncate text-[12px] font-semibold text-gray-700">{fit.location.label}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-gray-200 bg-gray-50 p-2.5" style={section(T.rate)}>
            <RateBar job={fit.rate.job} mine={fit.rate.mine} mineLabel={name.split(' ')[0]} mineColor={color} animate at={T.rate} />
            <p className="truncate text-[12px] font-semibold text-gray-700">{fit.rate.job ? `Pays $${Math.round(fit.rate.job)}/hr` : 'Rate not listed'}</p>
          </div>
        </div>}
        <div style={section(boxes && !picture ? T.eng : T.map)}><EngagementRow eng={item.eng} /></div>
        </>)}
      </div>

      <div data-rail className="absolute bottom-[76px] right-2 z-30 flex flex-col items-center gap-3.5">
        {item.teaser ? (
          <Link to="/billing" className={rail} title="Top up to see this match">
            <span className="grid h-[58px] w-[58px] place-items-center rounded-full bg-blue-600 shadow-[0_6px_18px_rgba(37,99,235,.5)]"><Lock size={22} /></span>Unlock
          </Link>
        ) : (<>
        <button type="button" className={rail} onClick={() => { if (kind === 'hotlist') flash('APPLIED', '#34d399'); onApply(item); }} title={kind === 'job' ? 'Ask for the resume' : site ? 'Apply on their site' : 'Apply by email'}>
          <span className={`grid h-[58px] w-[58px] place-items-center rounded-full ${site ? 'bg-emerald-600 shadow-[0_6px_18px_rgba(5,150,105,.5)]' : 'bg-blue-600 shadow-[0_6px_18px_rgba(37,99,235,.5)]'}`}>
            {kind === 'job' ? <FileText size={24} /> : site ? <ExternalLink size={22} /> : <Send size={24} />}
          </span>
          {kind === 'job' ? 'Ask Resume' : 'Apply'}
        </button>
        <button type="button" className={rail} onClick={() => { flash('SAVED', '#60a5fa'); onSave(item); }}><span className={railIcon}><Bookmark size={20} fill={saved ? 'currentColor' : 'none'} /></span>Save</button>
        <button type="button" className={rail} onClick={() => onShare(item)}><span className={railIcon}><Share2 size={20} /></span>Share</button>
        </>)}
        <button type="button" className={rail} onClick={() => { flash('PASS', '#f87171'); onDismiss(item); }}><span className={railIcon}><X size={20} /></span>Pass</button>
      </div>

      <div data-rail className={`relative z-30 flex items-center gap-2 px-4 pt-2.5 text-[13px] font-bold ${inline ? 'pb-4' : onSwipeUp ? 'pb-[calc(1.4rem+env(safe-area-inset-bottom))]' : 'pb-[calc(1rem+env(safe-area-inset-bottom))]'}`}>
        {item.teaser ? (
          <Link to="/billing" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2 text-gray-800"><Lock size={15} />Top up to see it</Link>
        ) : hideDetails ? <span className="text-gray-500">Swipe or use ← →</span> : (
          <button type="button" onClick={() => onDetails(item)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2 text-gray-800"><ChevronUp size={16} />{kind === 'job' ? 'Details' : 'Details and email'}</button>
        )}
        <span className="min-w-0 flex-1 truncate text-center text-[11px] font-semibold text-gray-400">{menuHint ? 'Swipe up for menu' : ''}</span>
        <span className="shrink-0 tabular-nums text-gray-500">{index + 1} / {items.length}</span>
      </div>
      {stampEl}
      {handle}
    </div>
  );
}
