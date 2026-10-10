import { useEffect, useState } from 'react';
import { Eye, Flame, MessageCircleQuestion, Send, Sparkles } from 'lucide-react';
import type { CardItem, Kind } from '../../lib/today';

// The Tracker's top row: what they've done this week (my_activity_stats),
// as cards that count up and draw themselves, and where their applications
// stand now.

export type ActivityStats = {
  days: Array<{ day: string; matches: number; watched: number; applied: number }>;
  week: { matches: number; watched: number; applied: number; saved: number; passed: number; asked: number };
  all: { matches: number; watched: number; applied: number; saved: number; asked: number };
  streak: number;
};

const reduced = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function useCount(target: number, delay = 120) {
  const [v, setV] = useState(() => (reduced() ? target : 0));
  useEffect(() => {
    if (reduced()) { setV(target); return undefined; }
    let raf = 0; let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, Math.max(0, (t - t0 - delay) / 900));
      setV(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delay]);
  return v;
}

// A bar a day for the last 14 days; this week darker.
function Bars({ values, color }: { values: number[]; color: string }) {
  const peak = Math.max(1, ...values);
  return (
    <span className="flex h-9 items-end gap-[2px]" aria-hidden="true">
      {values.map((n, k) => (
        <i key={k} className="w-[5px] origin-bottom rounded-sm"
          style={{ height: `${Math.max(8, (n / peak) * 100)}%`, background: n ? color : '#E8EEFC', opacity: n && k < 7 ? 0.45 : 1, animation: `ppBarUp .5s cubic-bezier(.2,.8,.2,1) ${120 + k * 30}ms both` }} />
      ))}
    </span>
  );
}

function Ring({ pct, color }: { pct: number; color: string }) {
  return (
    <svg width="44" height="44" viewBox="0 0 46 46" aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx="23" cy="23" r="18" fill="none" stroke="#E8EEFC" strokeWidth="6" />
      <circle cx="23" cy="23" r="18" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" pathLength={100}
        strokeDasharray={`${Math.max(0, Math.min(100, pct))} 100`} style={{ animation: 'ppRingFill 1s cubic-bezier(.2,.8,.2,1) .25s both' }} />
    </svg>
  );
}

const card = 'flex w-[168px] shrink-0 snap-start flex-col gap-2 rounded-2xl bg-white p-3.5 ring-1 ring-gray-200 dark:bg-[#20242a] dark:ring-white/10 sm:w-auto sm:min-w-0';
const label = 'flex items-center gap-1.5 text-[12px] font-bold text-gray-500 dark:text-slate-400';
const big = 'text-[28px] font-extrabold leading-none tracking-tight tabular-nums text-[#0B1A3A] dark:text-white';
const sub = 'text-[12px] font-semibold text-gray-500 dark:text-slate-400';

export default function TrackerStats({ stats, items, kind }: { stats: ActivityStats | null; items: CardItem[]; kind: Kind }) {
  const w = stats?.week ?? { matches: 0, watched: 0, applied: 0, saved: 0, passed: 0, asked: 0 };
  const all = stats?.all ?? { matches: 0, watched: 0, applied: 0, saved: 0, asked: 0 };
  const days = stats?.days ?? [];
  const watchedPct = w.matches ? Math.min(100, Math.round((w.watched / w.matches) * 100)) : 0;
  const nMatches = useCount(w.matches), nWatched = useCount(w.watched, 180), nApplied = useCount(w.applied, 240), nAsked = useCount(w.asked, 300), nStreak = useCount(stats?.streak ?? 0, 360);
  // Where their applications stand now.
  const count = (stage: string) => items.filter((i) => i.stage === stage).length;
  const parts: Array<[string, number, string]> = [
    ['Waiting', count('submitted'), '#C8D7FA'], ['Replied', count('replied'), '#2563EB'],
    ['Interview', count('interview'), '#7c3aed'], ['Placed', count('placed'), '#10b981'], ['Closed', count('closed'), '#e5e7eb'],
  ];
  const fade = (i: number) => ({ animation: `ppFadeUp .4s ease-out ${i * 60}ms both` });

  return (
    // Phones: one row that scrolls sideways; wider: a grid.
    <section className="-mx-2 flex snap-x gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-6" aria-label="This week">
      <div className={card} style={fade(0)}>
        <span className={label}><Sparkles size={13} className="text-[#2563EB]" />Matches</span>
        <span className="flex items-end justify-between gap-2"><b className={big}>{nMatches}</b><Bars values={days.map((d) => d.matches)} color="#2563EB" /></span>
        <span className={sub}>this week · {all.matches} in all</span>
      </div>

      <div className={card} style={fade(1)}>
        <span className={label}><Eye size={13} className="text-[#2563EB]" />Watched</span>
        <span className="flex items-center justify-between gap-2"><b className={big}>{nWatched}</b><Ring pct={watchedPct} color="#2563EB" /></span>
        <span className={sub}><b className="text-[#2563EB]">{watchedPct}%</b> of this week&apos;s matches</span>
      </div>

      <div className={card} style={fade(2)}>
        <span className={label}><Send size={13} className="text-emerald-600" />{kind === 'job' ? 'Resumes asked' : 'Resumes sent'}</span>
        <span className="flex items-end justify-between gap-2"><b className={big}>{nApplied}</b><Bars values={days.map((d) => d.applied)} color="#10b981" /></span>
        <span className={sub}>this week · {all.applied} in all</span>
      </div>

      <div className={card} style={fade(3)}>
        <span className={label}><MessageCircleQuestion size={13} className="text-[#7c3aed]" />Asked posters</span>
        <span className="flex items-center justify-between gap-2">
          <b className={big}>{nAsked}</b>
          <span className="flex flex-col items-end text-[11px] font-bold text-gray-500 dark:text-slate-400"><span>Saved {w.saved}</span><span>Passed {w.passed}</span></span>
        </span>
        <span className={sub}>rate, visa or location</span>
      </div>

      <div className={`${card} ${stats?.streak ? 'bg-gradient-to-br from-[#FFF4E8] to-white' : ''}`} style={fade(4)}>
        <span className={label}><Flame size={13} className="text-[#F97316]" />Streak</span>
        <span className="flex items-center justify-between gap-2">
          <b className={big}>{nStreak}<small className="ml-1 text-[13px] font-bold text-gray-500">days</small></b>
          {/* The last 7 days: lit when they watched. */}
          <span className="flex gap-[3px]" aria-hidden="true">
            {days.slice(-7).map((d, k) => (
              <Flame key={d.day} size={13} className={d.watched ? 'text-[#F97316]' : 'text-gray-200'} fill={d.watched ? 'currentColor' : 'none'}
                style={{ animation: `ppPop .35s cubic-bezier(.2,.8,.2,1) ${400 + k * 60}ms both` }} />
            ))}
          </span>
        </span>
        <span className={sub}>{stats?.streak ? 'Watch today to keep it' : 'Watch a match to start one'}</span>
      </div>

      <div className={card} style={fade(5)}>
        <span className={label}>Where they stand</span>
        <div className="flex h-2.5 origin-left overflow-hidden rounded-full bg-gray-100 dark:bg-white/5" style={{ animation: 'ppGrowX .8s cubic-bezier(.2,.8,.2,1) .3s both' }}>
          {parts.filter(([, n]) => n > 0).map(([name, n, color]) => <i key={name} title={`${name}: ${n}`} style={{ width: `${(n / Math.max(1, items.length)) * 100}%`, background: color }} />)}
        </div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] font-semibold text-gray-600 dark:text-slate-300">
          {parts.filter(([, n]) => n > 0).map(([name, n, color]) => <span key={name} className="inline-flex items-center gap-1 tabular-nums"><i className="h-2 w-2 rounded-full" style={{ background: color }} />{name} {n}</span>)}
        </div>
      </div>
    </section>
  );
}
