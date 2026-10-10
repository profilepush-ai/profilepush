import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Check, ChevronUp, ExternalLink, FileText, History, Send, Share2, Sparkles, X } from 'lucide-react';
import { agoLabel, hashColor } from '../../lib/match-fit';
import { fitFor, leadOrg, leadTitle, subjectName, type CardItem, type Kind, type Subject } from '../../lib/today';
import { CompanyLogo, FitBadges, FitRing, Initials, RateBar, SkillTiles, UsMap } from './Visuals';

// Swipe mode: one match per screen, stories style. Swipe or tap the sides to
// move; the rail on the right is Apply, Save, Share and Pass. On a phone it is
// Today itself, full screen, with the search and chips in `top`; swiping up or
// down there is passed on (Today uses it to show its menus). On desktop it
// sits in the page beside the detail.
export default function SwipeDeck({
  items, kind, subjects, startId, focusId, appliedToday, inline = false, hideDetails = false, paused = false, emptyMessage,
  top, layer = 'z-[80]', boxes = true, menuHint = false, onClose, onCurrent, onStep, onSwipeUp, onSwipeDown, onTouch,
  onSeen, onApply, onSave, onShare, onDismiss, onDetails,
}: {
  items: CardItem[]; kind: Kind; subjects: Record<string, Subject>; startId: string | null; focusId?: string | null; appliedToday: number;
  inline?: boolean; hideDetails?: boolean; paused?: boolean; emptyMessage?: { title: string; text: string };
  top?: ReactNode; layer?: string; boxes?: boolean; menuHint?: boolean;
  onClose?: () => void; onCurrent?: (item: CardItem | null) => void; onStep?: (d: 1 | -1, toId: string | null) => void;
  onSwipeUp?: () => void; onSwipeDown?: () => void; onTouch?: () => void;
  onSeen: (item: CardItem) => void; onApply: (item: CardItem) => void; onSave: (item: CardItem) => void;
  onShare: (item: CardItem) => void; onDismiss: (item: CardItem) => void; onDetails: (item: CardItem) => void;
}) {
  const [currentId, setCurrentId] = useState<string | null>(startId ?? items[0]?.card_id ?? null);
  const [dir, setDir] = useState<'n' | 'p' | null>('n');
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const index = items.findIndex((i) => i.card_id === currentId);
  // Back from the detail view: show the card it ended on.
  useEffect(() => {
    if (focusId && focusId !== currentId && items.some((i) => i.card_id === focusId)) { setCurrentId(focusId); setDir(null); }
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = index >= 0 ? items[index] : null;

  // When the current card leaves (applied, saved, passed), show the one after it.
  const lastIndex = useRef(0);
  useEffect(() => {
    if (index >= 0) { lastIndex.current = index; return; }
    const next = items[Math.min(lastIndex.current, items.length - 1)];
    setCurrentId(next?.card_id ?? null);
    setDir('n');
  }, [index, items]);

  useEffect(() => { if (item) onSeen(item); onCurrent?.(item); }, [item?.card_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (d: 1 | -1) => {
    const j = index + d;
    if (index < 0 || j < 0) return;
    if (j >= items.length) { setCurrentId(null); onStep?.(d, null); return; }
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

  const shell = inline
    ? 'relative flex h-full min-h-0 select-none flex-col overflow-hidden rounded-[22px] bg-[#0b0f1a] text-white'
    : `fixed inset-0 ${layer} flex select-none flex-col overflow-hidden bg-[#0b0f1a] pt-[env(safe-area-inset-top)] text-white`;
  const corner = inline || !onClose
    ? null
    : <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10"><X size={22} /></button>;
  const topSlot = top ? <div data-rail className="relative z-30 px-3 pt-2.5">{top}</div> : null;
  // Vertical swipes go to the page (menus); sideways ones move the deck.
  const gestures = {
    style: { touchAction: inline ? 'pan-y' : 'none' } as const,
    onPointerDown: (e: ReactPointerEvent) => {
      onTouch?.();
      start.current = (e.target as HTMLElement).closest('[data-rail]') ? null : { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        swiped.current = true;
        if (dy < 0) onSwipeUp?.(); else onSwipeDown?.();
        return;
      }
      if (Math.abs(dx) > 50) { swiped.current = true; step(dx < 0 ? 1 : -1); }
    },
    onPointerCancel: () => { start.current = null; },
  };
  // The home-bar handle: swipe up from here for the menus.
  const handle = onSwipeUp ? <span aria-hidden="true" className="pointer-events-none absolute bottom-[calc(6px+env(safe-area-inset-bottom))] left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/40" /> : null;

  if (!item || !item.lead) {
    return (
      <div className={shell} role={inline || !onClose ? 'region' : 'dialog'} aria-label="All caught up" {...gestures}>
        <div className="pointer-events-none absolute -left-1/3 -right-1/3 -top-1/4 h-3/4 opacity-60" style={{ background: 'radial-gradient(closest-side, #10b981, transparent)' }} />
        {topSlot}
        {corner && <div className="relative z-10 flex justify-end p-2">{corner}</div>}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-emerald-600"><Check size={36} strokeWidth={3} /></span>
          <h2 className="text-[26px] font-extrabold">{emptyMessage?.title ?? 'All caught up'}</h2>
          <p className="max-w-[28ch] text-white/80">{emptyMessage?.text ?? `${appliedToday} applied today. New matches arrive every 10 minutes.`}</p>
          {inline || !onClose ? (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Link to="/history" className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2.5 font-bold"><History size={16} />History</Link>
              <Link to="/match" className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2.5 font-bold"><Sparkles size={16} />Run AI Match</Link>
            </div>
          ) : (
            <button type="button" onClick={onClose} className="mt-2 rounded-full bg-white/15 px-5 py-2.5 font-bold">Back to Today</button>
          )}
        </div>
        {handle}
      </div>
    );
  }

  const lead = item.lead;
  const subject = subjects[item.subject_id];
  const fit = fitFor(kind, subject, lead);
  const site = kind === 'hotlist' && lead.source === 'career_site';
  const color = hashColor(item.subject_id);
  const name = subjectName(kind, subject);
  const saved = Boolean(item.saved_at);
  const rail = 'flex flex-col items-center gap-1 text-[11px] font-bold';
  const railIcon = 'grid h-[46px] w-[46px] place-items-center rounded-full bg-white/15';

  return (
    <div
      className={shell}
      role={inline || !onClose ? 'region' : 'dialog'}
      aria-label="Swipe through matches"
      {...gestures}
    >
      <div className="pointer-events-none absolute -left-1/3 -right-1/3 -top-1/4 h-3/4 opacity-60" style={{ background: `radial-gradient(closest-side, ${hashColor(leadOrg(lead))}, transparent)` }} />
      <div className="relative z-20 flex gap-[3px] px-2.5 pt-2.5" aria-hidden="true">
        {items.slice(0, 40).map((x, k) => <i key={x.card_id} className={`h-[3px] flex-1 rounded-sm ${k <= index ? 'bg-white' : 'bg-white/25'}`} />)}
      </div>
      {topSlot}
      <div className="relative z-20 flex items-center gap-2.5 py-2.5 pl-3 pr-2">
        <Initials name={name} id={item.subject_id} size={32} />
        <div className="min-w-0 flex-1"><b className="block truncate text-[14px]">for {name}</b><small className="block truncate text-[11.5px] text-white/75">{kind === 'hotlist' ? subject?.title : 'Your job'}</small></div>
        {corner}
      </div>

      <button type="button" aria-label="Previous match" onClick={() => { if (swiped.current) { swiped.current = false; return; } step(-1); }} className="absolute bottom-[70px] left-0 top-[70px] z-10 w-[30%]" />
      <button type="button" aria-label="Next match" onClick={() => { if (swiped.current) { swiped.current = false; return; } step(1); }} className="absolute bottom-[70px] right-0 top-[70px] z-10 w-[30%]" />

      <div key={item.card_id} style={{ justifyContent: 'safe center' }} className={`pointer-events-none relative z-0 flex min-h-0 flex-1 flex-col justify-center gap-3.5 overflow-hidden py-1.5 pl-4 pr-20 ${dir === 'n' ? 'animate-[ppSwipeIn_.25s_ease-out]' : dir === 'p' ? 'animate-[ppSwipeBack_.25s_ease-out]' : ''}`}>
        <div className="flex items-center gap-2.5">
          <CompanyLogo name={leadOrg(lead)} avatar={lead.avatar} domain={lead.logo_domain} size={46} round={Boolean(lead.avatar)} />
          <div className="min-w-0"><b className="block truncate text-[15px]">{leadOrg(lead)}</b><small className="block text-[12px] text-white/75">{kind === 'job' ? 'Profile' : site ? 'Apply on site' : 'Apply by email'} · {agoLabel(lead.posted_at)} ago</small></div>
        </div>
        <h2 className="text-balance text-[25px] font-extrabold leading-[1.15] tracking-tight">{leadTitle(lead)}</h2>
        <div className="flex items-center gap-3"><FitRing value={item.fit ?? Math.round(item.similarity * 100)} size={72} onDark /><FitBadges fit={fit} onDark /></div>
        <SkillTiles skills={fit.skills.slice(0, 6)} onDark />
        {/* Where there's no room, the badges above say the same. */}
        {boxes && <div className="grid grid-cols-2 gap-2.5">
          <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/[0.07] p-2.5">
            <UsMap jobState={fit.location.jobState} profileState={fit.location.profileState} remote={fit.location.kind === 'remote'} profileColor={color} onDark />
            <p className="truncate text-[12px] font-semibold text-white/85">{fit.location.label}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/[0.07] p-2.5">
            <RateBar job={fit.rate.job} mine={fit.rate.mine} mineLabel={name.split(' ')[0]} mineColor={color} onDark />
            <p className="truncate text-[12px] font-semibold text-white/85">{fit.rate.job ? `Pays $${Math.round(fit.rate.job)}/hr` : 'Rate not listed'}</p>
          </div>
        </div>}
      </div>

      <div data-rail className="absolute bottom-[76px] right-2 z-30 flex flex-col items-center gap-3.5">
        <button type="button" className={rail} onClick={() => onApply(item)} title={kind === 'job' ? 'Ask for the resume' : site ? 'Apply on their site' : 'Apply by email'}>
          <span className={`grid h-[58px] w-[58px] place-items-center rounded-full ${site ? 'bg-emerald-600 shadow-[0_6px_18px_rgba(5,150,105,.5)]' : 'bg-blue-600 shadow-[0_6px_18px_rgba(37,99,235,.5)]'}`}>
            {kind === 'job' ? <FileText size={24} /> : site ? <ExternalLink size={22} /> : <Send size={24} />}
          </span>
          {kind === 'job' ? 'Ask Resume' : 'Apply'}
        </button>
        <button type="button" className={rail} onClick={() => onSave(item)}><span className={railIcon}><Bookmark size={20} fill={saved ? 'currentColor' : 'none'} /></span>Save</button>
        <button type="button" className={rail} onClick={() => onShare(item)}><span className={railIcon}><Share2 size={20} /></span>Share</button>
        <button type="button" className={rail} onClick={() => onDismiss(item)}><span className={railIcon}><X size={20} /></span>Pass</button>
      </div>

      <div data-rail className={`relative z-30 flex items-center gap-2 px-4 pt-2.5 text-[13px] font-bold ${inline ? 'pb-4' : onSwipeUp ? 'pb-[calc(1.4rem+env(safe-area-inset-bottom))]' : 'pb-[calc(1rem+env(safe-area-inset-bottom))]'}`}>
        {hideDetails ? <span className="text-white/60">Swipe or use ← →</span> : (
          <button type="button" onClick={() => onDetails(item)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2"><ChevronUp size={16} />{kind === 'job' ? 'Details' : 'Details and email'}</button>
        )}
        <span className="min-w-0 flex-1 truncate text-center text-[11px] font-semibold text-white/55">{menuHint ? 'Swipe up for menu' : ''}</span>
        <span className="shrink-0 tabular-nums text-white/70">{index + 1} / {items.length}</span>
      </div>
      {handle}
    </div>
  );
}
