import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Check, ChevronRight, ExternalLink, FileText, History, Maximize2, Pause, Play, Flag, Info, Lock, Send, Share2, Sparkles, Timer, X } from 'lucide-react';
import { priceLabels, useCurrency } from '../../lib/currency';
import { agoLabel, hashColor } from '../../lib/match-fit';
import { fitFor, leadOrg, leadTitle, missingFor, pictureFor, subjectName, timeLeft, type CardItem, type Kind, type Question, type Subject } from '../../lib/today';
import { AskChips, CompanyLogo, FitBadges, FitLine, Initials, RateBar, SkillTiles, UsMap } from './Visuals';
import PushStreak from './PushStreak';
import { PUSH_EASE, PUSH_MS, pushGhost } from '../../lib/push';

// When each section of a card arrives (ms): one quick cascade, the same in
// the reel and out of it. Inside, only the match line swings, the route
// draws and the rate marker slides.
const T = { title: 70, ring: 140, ask: 210, skills: 280, map: 350, rate: 420, eng: 490 };
const section = (at: number) => ({ animation: `ppSection 560ms cubic-bezier(.2,.9,.25,1) ${at}ms both`, willChange: 'transform, opacity, filter' });

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
  top, layer = 'z-[80]', boxes = true, reelMs, endScreen, expiring = false, viewerId, teaserSince = null, asked, onAsk, hideAsk = false, navBelow = false, onClose, onCollapse, onExpand, onCurrent, onStep, onSwipeUp, onSwipeDown, onTouch,
  onSeen, onApply, onSave, onShare, onDismiss, onDetails, onReportPicture,
}: {
  items: CardItem[]; kind: Kind; subjects: Record<string, Subject>; startId: string | null; focusId?: string | null; appliedToday: number;
  inline?: boolean; hideDetails?: boolean; paused?: boolean; emptyMessage?: { title: string; text: string };
  /** Above the card. As a function it also gets the deck's pause and ⌄ buttons, to place in its own row. */
  top?: ReactNode | ((controls: ReactNode) => ReactNode); layer?: string; boxes?: boolean; menuHint?: boolean;
  /** Picks which version of a post's picture this viewer sees. */
  viewerId?: string;
  /** A free account's previews began (for the days left on a teaser). */
  teaserSince?: string | null;
  /** Plays like a reel: each card moves on after this long (hold to pause). */
  reelMs?: number;
  /** Shown after the last card, instead of the plain "All caught up". */
  endScreen?: ReactNode;
  /** The app's bottom menu sits right below (phones): no room kept for the home bar. */
  navBelow?: boolean;
  /** Today's cards: show how long each has left before it leaves Today. */
  expiring?: boolean;
  /** Ask the poster for what the post leaves out. */
  asked?: Record<string, Question[]>; onAsk?: (item: CardItem, q: Question) => void;
  /** The Ask buttons live elsewhere (desktop: the detail beside the deck). */
  hideAsk?: boolean;
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
  // Moving on is a push: the next card shoves this one (and its picture) off.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const picRef = useRef<HTMLDivElement | null>(null);
  const [push, setPush] = useState<{ n: number; to: 1 | -1; at: number } | null>(null);
  // How the card on screen came in, fixed while it's showing. Re-renders
  // after the push (the match marked seen, a tick) must not swap its
  // animation: a changed animation restarts, and that was the blink.
  const entry = useRef<{ id: string; anim: string | undefined; pushed: boolean; dir: 'n' | 'p' | null } | null>(null);
  const pushOut = (to: 1 | -1) => {
    if (pushGhost(shellRef.current, [picRef.current, cardRef.current], to)) setPush((p) => ({ n: (p?.n ?? 0) + 1, to, at: Date.now() }));
  };
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
    pushOut(d > 0 ? -1 : 1);
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

  // The next three pictures (and the one before) are downloaded and decoded
  // ahead and kept, so a swipe paints its picture at once, never blank first.
  const ready = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    if (index < 0) return;
    const near = [...items.slice(index + 1, index + 4), items[index - 1]].filter(Boolean) as CardItem[];
    for (const next of near) {
      const url = next.lead ? pictureFor(next.lead, viewerId) : null;
      if (!url || ready.current.has(url)) continue;
      const im = new Image();
      im.src = url;
      void im.decode?.().catch(() => {});
      ready.current.set(url, im);
      if (ready.current.size > 12) ready.current.delete(ready.current.keys().next().value as string);
    }
  }, [index, items, viewerId]);

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
      {onCollapse ? (
        // Out of full screen, said in words.
        <button type="button" onClick={onCollapse} title="Close full screen"
          className="inline-flex h-9 items-center rounded-full bg-white/85 px-3.5 text-[13.5px] font-bold text-gray-800 shadow-sm ring-1 ring-black/5 backdrop-blur hover:bg-white">
          Close
        </button>
      ) : (
        <button type="button" onClick={onExpand} aria-label="Full screen" title="Full screen"
          className="grid h-9 w-9 place-items-center rounded-full bg-white/80 text-gray-700 shadow-sm ring-1 ring-black/5 backdrop-blur hover:bg-white">
          <Maximize2 size={16} />
        </button>
      )}
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
        step(d);
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
      <div ref={shellRef} className={`${shell} pp-anim`} role={inline || !onClose ? 'region' : 'dialog'} aria-label="All caught up" {...gestures}>
        <div className="pointer-events-none absolute -left-1/3 -right-1/3 -top-1/4 h-3/4 opacity-60" style={{ background: 'radial-gradient(closest-side, #10b981, transparent)' }} />
        {topSlot}
        {corner && <div className="relative z-10 flex justify-end p-2">{corner}</div>}
        {sizeButton && ownControls && <div className="relative z-30 flex justify-end px-3 pt-2">{sizeButton}</div>}
        {endScreen && !emptyMessage ? <div className="relative z-10 flex min-h-0 flex-1 flex-col">{endScreen}</div> : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-emerald-600 text-white"><Check size={36} strokeWidth={3} /></span>
          <h2 className="text-[26px] font-extrabold">{emptyMessage?.title ?? 'All caught up'}</h2>
          <p className="max-w-[28ch] text-gray-600">{emptyMessage?.text ?? `${appliedToday} applied today. New matches arrive every 10 minutes.`}</p>
          {inline || !onClose ? (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Link to="/history" className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-2.5 font-bold text-gray-800"><History size={16} />History</Link>
              <Link to="/match" className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2.5 font-bold text-white"><Sparkles size={16} />Run AI Match</Link>
            </div>
          ) : (
            <button type="button" onClick={onClose} className="mt-2 rounded-full bg-gray-100 px-5 py-2.5 font-bold text-gray-800">Back to Today</button>
          )}
        </div>
        )}
        {push && Date.now() - push.at < PUSH_MS + 100 && <PushStreak key={push.n} to={push.to} />}
        {stampEl}
        {handle}
      </div>
    );
  }

  const lead = item.lead;
  const subject = subjects[item.subject_id];
  const fit = fitFor(kind, subject, lead);
  const site = kind === 'hotlist' && lead.source === 'career_site';
  // The job's own picture (avatars are for people's profiles, not matches).
  const picture = pictureFor(lead, viewerId);
  const previewDays = teaserSince ? Math.max(0, 7 - Math.floor((Date.now() - new Date(teaserSince).getTime()) / 86_400_000)) : null;
  const color = hashColor(item.subject_id);
  const name = subjectName(kind, subject);
  const saved = Boolean(item.saved_at);
  const forLine = kind === 'job' ? 'Your job'
    : subject?.name ? subject.title
      : [subject?.years ? `${Math.round(Number(subject.years))} yrs` : null, subject?.visa].filter(Boolean).join(' · ') || null;
  // A card's first render decides how it came in (pushed, slid, or plain).
  if (entry.current?.id !== item.card_id) {
    const pushNow = push && Date.now() - push.at < PUSH_MS ? `${push.to < 0 ? 'ppPushInL' : 'ppPushInR'} ${PUSH_MS}ms ${PUSH_EASE} both` : undefined;
    entry.current = { id: item.card_id, anim: pushNow, pushed: Boolean(pushNow), dir };
  }
  // Just pushed: this card (and its picture) slides in from the other side.
  const pushIn = entry.current.anim;
  const entryDir = entry.current.dir;
  // Pushed in: the card slides in whole; its parts don't fade in again on top.
  const sec = (at: number) => (entry.current?.pushed ? undefined : section(at));

  return (
    <div
      ref={shellRef}
      className={`${shell} pp-anim`}
      role={inline || !onClose ? 'region' : 'dialog'}
      aria-label="Swipe through matches"
      {...gestures}
    >
      {picture ? (
        // Behind everything: the same picture, blurred, so the top bar and the
        // details sit on its colours and the sharp one in the middle melts in.
        <div key={`${item.card_id}:${picture}`} ref={picRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-[#eef2f8]" style={{ animation: pushIn ?? 'ppPicture .6s ease-out both' }}>
          <img src={picture} alt="" decoding="sync" className="absolute inset-0 h-full w-full scale-[1.3] object-cover blur-[38px] saturate-[1.5]" />
          <div className="absolute inset-0 bg-white/30" />
        </div>
      ) : (
        <div key={item.card_id} ref={picRef} className="pointer-events-none absolute -left-1/3 -right-1/3 -top-1/4 h-3/4 opacity-60" style={{ background: `radial-gradient(closest-side, ${hashColor(leadOrg(lead))}, transparent)`, animation: pushIn }} />
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
      {((ownControls && (playButton || sizeButton)) || corner) && (
        <div className="relative z-20 flex justify-end gap-2 px-3 pt-2">{ownControls && playButton}{ownControls && sizeButton}{corner}</div>
      )}

      <button type="button" aria-label="Previous match" onClick={() => { if (swiped.current) { swiped.current = false; return; } step(-1); }} className="absolute bottom-[70px] left-0 top-[70px] z-10 w-[30%]" />
      <button type="button" aria-label="Next match" onClick={() => { if (swiped.current) { swiped.current = false; return; } step(1); }} className="absolute bottom-[70px] right-0 top-[70px] z-10 w-[30%]" />

      {/* The card: the picture on its stage, then the details and the actions.
          It lets taps through to the sides (previous/next) except on its
          own buttons and panel. */}
      <div key={item.card_id} ref={cardRef} style={{ animation: pushIn }} className={`pointer-events-none relative z-20 flex min-h-0 flex-1 flex-col gap-2.5 px-3 pb-2 pt-2 ${inline || navBelow ? 'pb-3' : onSwipeUp ? 'pb-[calc(1.1rem+env(safe-area-inset-bottom))]' : 'pb-[calc(.6rem+env(safe-area-inset-bottom))]'} ${pushIn ? '' : entryDir === 'n' ? 'animate-[ppSwipeIn_.25s_ease-out]' : entryDir === 'p' ? 'animate-[ppSwipeBack_.25s_ease-out]' : ''}`}>
        {picture ? (
          // The stage: the picture, sharp and framed on the person, its edges
          // fading into the blurred copy behind (no border).
          <div className="relative min-h-[120px] flex-1" style={sec(0)}>
            <img src={picture} alt="" decoding="sync" className="absolute inset-0 h-full w-full object-cover object-[50%_16%]"
              style={{ maskImage: 'linear-gradient(180deg, transparent 0%, #000 10%, #000 84%, transparent 100%)', WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 10%, #000 84%, transparent 100%)' }} />
            <span data-rail className="pointer-events-auto absolute right-0 top-1">
              <button type="button" onClick={() => setNoteFor(noteFor === item.card_id ? null : item.card_id)} aria-expanded={noteFor === item.card_id}
                aria-label="About this AI picture" title="AI picture"
                className="grid h-8 w-8 place-items-center rounded-full bg-white/80 text-gray-700 shadow-sm ring-1 ring-black/5 backdrop-blur">
                <Info size={16} />
              </button>
              {noteFor === item.card_id && (
                <span role="dialog" aria-label="About this picture" className="absolute right-0 top-10 z-50 block w-[270px] rounded-2xl bg-white p-3.5 text-left text-[12.5px] leading-snug text-gray-700 shadow-2xl">
                  <b className="mb-1 block text-[13.5px] text-gray-900">An AI illustration</b>
                  Made by AI to picture this role. It isn&apos;t a real person, and it&apos;s never chosen from anyone&apos;s name or background. ProfilePush stands against racism and discrimination of any kind. If a picture feels wrong, tell us and we&apos;ll draw a new one.
                  {onReportPicture && (
                    <button type="button" onClick={() => { onReportPicture(item, picture); setNoteFor(null); }}
                      className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-gray-100 text-[13px] font-bold text-gray-800 hover:bg-gray-200">
                      <Flag size={14} />Report this picture
                    </button>
                  )}
                </span>
              )}
            </span>
          </div>
        ) : boxes ? (
          // No picture (desktop): where it is and what it pays, drawn.
          <div className="grid min-h-0 flex-1 grid-cols-2 content-center gap-2.5">
            <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-gray-200 bg-white/80 p-2.5" style={sec(T.map)}>
              <UsMap jobState={fit.location.jobState} profileState={fit.location.profileState} remote={fit.location.kind === 'remote'} profileColor={color} animate wave={false} at={T.map - 300} />
              <p className="truncate text-[12px] font-semibold text-gray-700">{fit.location.label}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-gray-200 bg-white/80 p-2.5" style={sec(T.rate)}>
              <RateBar job={fit.rate.job} mine={fit.rate.mine} mineLabel={name.split(' ')[0]} mineColor={color} animate at={T.rate} />
              <p className="truncate text-[12px] font-semibold text-gray-700">{fit.rate.job ? `Pays $${Math.round(fit.rate.job)}/hr` : 'Rate not listed'}</p>
            </div>
          </div>
        ) : <div className="flex-1" />}

        {/* The details: crisp, compact, and the actions within thumb's reach. */}
        <div className="pointer-events-auto shrink-0 rounded-[24px] bg-white/95 p-3.5 shadow-[0_14px_36px_rgba(11,26,58,.16)] ring-1 ring-black/5 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-[12px]">
            <Initials name={name} id={item.subject_id} size={22} />
            <span className="min-w-0 flex-1 truncate font-semibold text-gray-500">for <b className="text-gray-900">{name}</b>{forLine ? ` · ${forLine}` : ''}</span>
            {expiring && !item.teaser && <TimeLeft item={item} />}
          </div>
          {item.teaser ? (
            // A free preview: the title and match score; the rest unlocks with a top-up.
            <>
              <span className="mt-2.5 inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-700 ring-1 ring-amber-200" style={sec(0)}><Lock size={13} />Free preview</span>
              <h2 className="mt-2 line-clamp-2 text-balance text-[22px] font-extrabold leading-[1.15] tracking-tight" style={sec(T.title)}>{leadTitle(lead)}</h2>
              <div className="mt-1.5" style={sec(T.ring)}><FitLine value={item.fit ?? Math.round(item.similarity * 100)} animate at={T.ring + 150} /></div>
              <p className="mt-2 text-[12.5px] font-semibold text-gray-600" style={sec(T.skills)}>The company, rate, skills and how to apply are in this match.{previewDays != null ? ` ${previewDays} ${previewDays === 1 ? 'day' : 'days'} of free previews left.` : ''}</p>
            </>
          ) : (<>
            <div className="mt-2.5 flex items-center gap-2.5" style={sec(0)}>
              <CompanyLogo name={leadOrg(lead)} avatar={lead.avatar} domain={lead.logo_domain} size={38} round={Boolean(lead.avatar)} />
              <div className="min-w-0 flex-1"><b className="block truncate text-[14.5px]">{leadOrg(lead)}</b><small className="block truncate text-[12px] text-gray-500">{kind === 'job' ? 'Profile' : site ? 'Apply on site' : 'Apply by email'} · {agoLabel(lead.posted_at)} ago</small></div>
              {!hideDetails && (
                <button type="button" data-rail onClick={() => onDetails(item)} className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full bg-gray-100 pl-3 pr-2 text-[12.5px] font-bold text-gray-700 hover:bg-gray-200">
                  Details<ChevronRight size={15} />
                </button>
              )}
            </div>
            <h2 className="mt-2 line-clamp-2 text-balance text-[22px] font-extrabold leading-[1.15] tracking-tight" style={sec(T.title)}>{leadTitle(lead)}</h2>
            <div className="mt-1.5" style={sec(T.ring)}><FitLine value={item.fit ?? Math.round(item.similarity * 100)} animate at={T.ring + 150} /></div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5" style={sec(T.ring)}>
              <FitBadges fit={fit} hide={onAsk && lead.has_email ? missingFor(kind, fit) : []} />
              {!hideAsk && onAsk && lead.has_email && missingFor(kind, fit).length > 0 && (
                <span data-rail><AskChips missing={missingFor(kind, fit)} asked={asked?.[item.lead_id] ?? []} onAsk={(q) => onAsk(item, q)} /></span>
              )}
            </div>
            <div className="mt-2 max-h-[62px] overflow-hidden" style={sec(T.skills)}><SkillTiles skills={fit.skills.slice(0, 5)} /></div>
          </>)}

          <div data-rail className="mt-3 flex items-center gap-2">
            {item.teaser ? (
              <Link to="/billing" className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-blue-600 text-[15px] font-extrabold text-white shadow-[0_8px_22px_rgba(37,99,235,.35)]">
                <Lock size={16} />Unlock · from {price.minTopup}
              </Link>
            ) : (<>
              <button type="button" onClick={() => { pushOut(-1); flash('PASS', '#f87171'); onDismiss(item); }} aria-label="Pass" title="Pass"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"><X size={20} /></button>
              <button type="button" onClick={() => { if (!saved) pushOut(-1); flash('SAVED', '#60a5fa'); onSave(item); }} aria-label={saved ? 'Saved' : 'Save'} title="Save"
                className={`grid h-12 w-12 shrink-0 place-items-center rounded-full hover:bg-gray-200 ${saved ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-700'}`}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} /></button>
              <button type="button" onClick={() => onShare(item)} aria-label="Share" title="Share"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"><Share2 size={19} /></button>
              <button type="button" onClick={() => { pushOut(1); if (kind === 'hotlist') flash('APPLIED', '#34d399'); onApply(item); }}
                title={kind === 'job' ? 'Ask for the resume' : site ? 'Apply on their site' : 'Apply by email'}
                className={`inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[15.5px] font-extrabold text-white ${site ? 'bg-emerald-600 shadow-[0_8px_22px_rgba(5,150,105,.35)]' : 'bg-blue-600 shadow-[0_8px_22px_rgba(37,99,235,.35)]'}`}>
                {kind === 'job' ? <FileText size={18} /> : site ? <ExternalLink size={17} /> : <Send size={18} />}
                {kind === 'job' ? 'Ask Resume' : site ? 'Apply on site' : 'Apply'}
              </button>
            </>)}
          </div>
        </div>
      </div>
      {push && Date.now() - push.at < PUSH_MS + 100 && <PushStreak key={push.n} to={push.to} />}
      {stampEl}
      {handle}
    </div>
  );
}
