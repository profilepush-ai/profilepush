import { useEffect, useState, type CSSProperties } from 'react';
import { PLAIN_SCORE_KEY, plainScore } from '../../lib/prefs';
import { Bookmark, Check, Code2, DollarSign, Eye, Flame, Globe, MapPin, Send, Share2, ShieldCheck, Sparkles } from 'lucide-react';
import { hashColor, skillLook, US_TILES, VISA_ORDER, type LocationFit } from '../../lib/match-fit';

// The pieces a match is drawn with: who posted it, how well it fits, and why.

// The poster's photo, else the firm's site icon, else a coloured monogram.
export function CompanyLogo({ name, avatar, domain, size = 46, round = false }: {
  name: string; avatar?: string | null; domain?: string | null; size?: number; round?: boolean;
}) {
  const sources = [avatar, domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null].filter((s): s is string => Boolean(s));
  const [step, setStep] = useState(0);
  const radius = round ? '50%' : Math.round(size * 0.28);
  const src = sources[step];
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className="shrink-0 bg-white object-cover ring-1 ring-black/5 dark:ring-white/10"
        style={{ width: size, height: size, borderRadius: radius }}
        // A site with no icon gets Google's tiny default globe: use the monogram.
        onLoad={(e) => { if (src.includes('s2/favicons') && e.currentTarget.naturalWidth < 32) setStep((n) => n + 1); }}
        onError={() => setStep((n) => n + 1)}
      />
    );
  }
  const color = hashColor(name || '?');
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center font-extrabold text-white"
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.44), background: `linear-gradient(140deg, ${color}, color-mix(in srgb, ${color} 62%, #000))` }}
    >
      {(name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function Initials({ name, id, size = 22 }: { name: string; id: string; size?: number }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const text = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? '?').slice(0, 2);
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-full font-bold text-white" style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: hashColor(id) }}>
      {text.toUpperCase()}
    </span>
  );
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// `animation` shorthand for a staggered entrance; nothing when not animating.
const anim = (on: boolean | undefined, name: string, ms: number, delay: number, ease = 'cubic-bezier(.2,.8,.2,1)'): CSSProperties =>
  (on ? { animation: `${name} ${ms}ms ${ease} ${delay}ms both` } : {});

// Counts from 0 up to the target, easing out (the match % as it's worked out).
function useCountUp(target: number, on: boolean, duration = 750, delay = 150) {
  const [value, setValue] = useState(on && !reducedMotion() ? 0 : target);
  useEffect(() => {
    if (!on || reducedMotion()) { setValue(target); return; }
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, Math.max(0, (t - t0 - delay) / duration));
      setValue(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setValue(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, on, duration, delay]);
  return value;
}

// The match score "guessing": it swings past the score and back, each swing
// smaller, for about three seconds, then lands on it. Playful, and it draws
// the eye to the number.

// Anyone who'd rather not see it chooses "Show score" once (lib/prefs).
function useGuess(target: number, on: boolean, duration = 3200, delay = 150): [number, boolean, () => void] {
  const animated = on && !reducedMotion() && !plainScore();
  const [value, setValue] = useState(animated ? 0 : target);
  const [done, setDone] = useState(!animated);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (!animated || skipped) { setValue(target); setDone(true); return; }
    setDone(false);
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, Math.max(0, (t - t0 - delay) / duration));
      const v = p >= 1 ? target : target * (1 - Math.exp(-3.4 * p) * Math.cos(2 * Math.PI * 2.2 * p));
      setValue(Math.max(0, Math.min(100, v)));
      if (p < 1) raf = requestAnimationFrame(tick); else setDone(true);
    };
    setValue(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animated, skipped, duration, delay]);
  const skip = () => { try { localStorage.setItem(PLAIN_SCORE_KEY, '1'); } catch { /* fine */ } setSkipped(true); };
  return [value, done, skip];
}

// The match score as a straight bar under the title, the number at its end.
export function FitLine({ value, onDark = false, animate = false, at = 150 }: { value: number; onDark?: boolean; animate?: boolean; at?: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const [guess, done, skip] = useGuess(v, animate, 3200, at);
  const shown = Math.round(guess);
  const color = shown >= 85 ? '#10b981' : shown >= 75 ? '#3b82f6' : '#94a3b8';
  return (
    <div role="img" aria-label={`${v}% match`} className="flex items-center gap-2.5">
      <div className={`h-2 min-w-0 flex-1 overflow-hidden rounded-full ${onDark ? 'bg-white/15' : 'bg-[var(--pp-ring-track)]'}`}>
        <i className="block h-full rounded-full" style={{ width: `${shown}%`, background: color }} />
      </div>
      <b className={`shrink-0 text-[16px] font-extrabold tabular-nums leading-none ${onDark ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
        {shown}%<small className={`ml-1 text-[11px] font-semibold ${onDark ? 'text-white/70' : 'text-gray-500 dark:text-slate-400'}`}>match</small>
      </b>
      {!done && (
        <button type="button" data-rail onClick={(e) => { e.stopPropagation(); skip(); }}
          className={`pointer-events-auto shrink-0 text-[11.5px] font-semibold underline underline-offset-2 ${onDark ? 'text-white/75' : 'text-gray-500'}`}>
          Show score
        </button>
      )}
    </div>
  );
}

// The match %. Animated, the ring sweeps round as the number counts up and
// changes colour as it passes 75 and 85; a strong match ends with a glow.
export function FitRing({ value, size = 44, onDark = false, animate = false, at = 150 }: { value: number; size?: number; onDark?: boolean; animate?: boolean; at?: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const shown = useCountUp(v, animate, 750, at);
  const color = shown >= 85 ? '#10b981' : shown >= 75 ? '#3b82f6' : '#94a3b8';
  return (
    <span
      role="img"
      aria-label={`${v}% match`}
      className={`grid shrink-0 place-items-center rounded-full ${onDark ? '' : 'pp-ring'}`}
      style={{
        width: size, height: size, background: `conic-gradient(${color} ${shown}%, ${onDark ? 'rgba(255,255,255,.18)' : 'var(--pp-ring-track)'} 0)`,
        ...(animate && v >= 85 ? { animation: `ppGlow 1.1s ease-out ${at + 800}ms 1` } : {}),
      }}
    >
      <span
        className={`grid place-items-center rounded-full font-extrabold tabular-nums tracking-tight ${onDark ? 'bg-[#0b0f1a] text-white' : 'bg-white text-gray-900 dark:bg-[#20242a] dark:text-white'}`}
        style={{ width: size - 8, height: size - 8, fontSize: size > 50 ? 15 : 12 }}
      >
        {shown}%
      </span>
    </span>
  );
}

type Tone = 'good' | 'warn' | 'na';
const TONE: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  warn: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  na: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-400',
};
const TONE_DARK: Record<Tone, string> = {
  good: 'bg-emerald-500/20 text-emerald-300',
  warn: 'bg-amber-500/20 text-amber-300',
  na: 'bg-white/10 text-white/70',
};

export type FitSummary = {
  skills: Array<{ name: string; ok: boolean }>;
  visa: { accepted: string[]; mine: string | null; ok: boolean | null };
  location: LocationFit;
  rate: { job: number | null; mine: number | null; kind: 'good' | 'warn' | 'na' };
};

// Skills, visa, location and rate as four coloured badges.
// hide: values the card already offers to ask the poster for (no empty badge beside the Ask).
export function FitBadges({ fit, onDark = false, animate = false, at = 250, gap = 80, hide = [] }: { fit: FitSummary; onDark?: boolean; animate?: boolean; at?: number; gap?: number; hide?: string[] }) {
  const tones = onDark ? TONE_DARK : TONE;
  const okSkills = fit.skills.filter((s) => s.ok).length;
  const skillTone: Tone = fit.skills.length === 0 ? 'na' : okSkills / fit.skills.length >= 0.6 ? 'good' : 'warn';
  const visaTone: Tone = fit.visa.ok == null ? 'na' : fit.visa.ok ? 'good' : 'warn';
  const locTone: Tone = fit.location.kind === 'unknown' ? 'na' : fit.location.kind === 'other' ? 'warn' : 'good';
  const badge = 'inline-flex items-center gap-1 rounded-lg px-2 py-[3px] text-[12px] font-bold tabular-nums';
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={`${badge} ${tones[skillTone]}`} style={anim(animate, 'ppPop', 320, at)} title={`${okSkills} of ${fit.skills.length} skills`}>
        <Code2 size={13} strokeWidth={2.4} />{fit.skills.length ? `${okSkills}/${fit.skills.length}` : 'Skills?'}
      </span>
      {!hide.includes('visa') && (
        <span className={`${badge} ${tones[visaTone]}`} style={anim(animate, 'ppPop', 320, at + gap)} title={fit.visa.accepted.length ? `Accepts ${fit.visa.accepted.join(', ')}` : 'Visa not listed'}>
          <ShieldCheck size={13} strokeWidth={2.4} />{fit.visa.mine ?? (fit.visa.accepted[0] || 'Visa?')}
        </span>
      )}
      {!hide.includes('location') && (
        <span className={`${badge} ${tones[locTone]}`} style={anim(animate, 'ppPop', 320, at + gap * 2)} title={fit.location.label}>
          {fit.location.kind === 'remote' ? <Globe size={13} strokeWidth={2.4} /> : <MapPin size={13} strokeWidth={2.4} />}
          <span className="max-w-[9rem] truncate">{fit.location.kind === 'city' ? 'Same city' : fit.location.kind === 'state' ? fit.location.jobState : fit.location.kind === 'remote' ? 'Remote' : fit.location.jobState ?? '–'}</span>
        </span>
      )}
      {!hide.includes('rate') && (
        <span className={`${badge} ${tones[fit.rate.kind]}`} style={anim(animate, 'ppPop', 320, at + gap * 3)} title={fit.rate.job ? `$${fit.rate.job}/hr` : 'Rate not listed'}>
          <DollarSign size={13} strokeWidth={2.4} />{fit.rate.job ? Math.round(fit.rate.job) : '–'}
        </span>
      )}
    </div>
  );
}

// The job's skills as tiles: lit when the profile has it, dashed when not.
// Animated, the profile's skills light up one by one and get their check,
// then the missing ones fade in.
export function SkillTiles({ skills, onDark = false, animate = false, at: start = 120, gap = 70 }: { skills: Array<{ name: string; ok: boolean }>; onDark?: boolean; animate?: boolean; at?: number; gap?: number }) {
  if (skills.length === 0) return <p className={`text-[12.5px] ${onDark ? 'text-white/70' : 'text-gray-500'}`}>No skills listed in the post.</p>;
  const lit = skills.filter((s) => s.ok).length;
  let missing = 0;
  // Outlined chips with the skill's full name: a solid border in the skill's
  // color and a check when the profile has it, dashed when it doesn't.
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((s, i) => {
        const look = skillLook(s.name);
        const at = start + i * gap;
        const tint = onDark ? `color-mix(in srgb, ${look.color} 65%, white)` : look.color;
        return s.ok ? (
          <span key={s.name} className={`inline-flex max-w-full items-center gap-1.5 rounded-full border-[1.5px] py-[3px] pl-1 pr-2.5 text-[12.5px] font-bold ${onDark ? 'text-white' : 'text-gray-900 dark:text-slate-100'}`}
            style={{ borderColor: tint, ...anim(animate, 'ppTileIn', 420, at) }}>
            <i className="grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full not-italic text-white" style={{ background: tint, ...anim(animate, 'ppStamp', 320, at + 260, 'ease-out') }}><Check size={10} strokeWidth={4} /></i>
            <span className="min-w-0 break-words">{s.name}</span>
          </span>
        ) : (
          <span key={s.name} title={`${s.name}: not on the profile`} style={anim(animate, 'ppFadeIn', 300, start + lit * gap + 120 + (missing++) * 50, 'ease-out')}
            className={`inline-flex max-w-full items-center rounded-full border-[1.5px] border-dashed px-2.5 py-[3px] text-[12.5px] font-semibold ${onDark ? 'border-white/40 text-white/65' : 'border-gray-300 text-gray-500 dark:border-slate-600 dark:text-slate-400'}`}>
            <span className="min-w-0 break-words">{s.name}</span>
          </span>
        );
      })}
    </div>
  );
}

// The job's state and the profile's state on a tile map of the US.
// Animated: the map ripples in, the profile's state lights up, a line draws
// to the job's state, which lights up and pings. Same state pulses; remote
// washes the whole map green.
export function UsMap({ jobState, profileState, remote, profileColor, onDark = false, animate = false, at = 0, wave: waveOn = true }: {
  jobState: string | null; profileState: string | null; remote?: boolean; profileColor: string; onDark?: boolean; animate?: boolean; at?: number;
  /** Ripple every tile in (heavier); off, only the two states and the route move. */
  wave?: boolean;
}) {
  const base = onDark ? 'rgba(255,255,255,.13)' : 'var(--pp-map-tile)';
  const waveEnd = at + 520;
  const route = !remote && jobState && profileState && jobState !== profileState && US_TILES[jobState] && US_TILES[profileState]
    ? { from: US_TILES[profileState], to: US_TILES[jobState] } : null;
  const jobAt = route ? waveEnd + 560 : waveEnd + 120;
  let path = '';
  if (route) {
    const [pr, pc] = route.from;
    const [jr, jc] = route.to;
    const px = (pc + 0.5) * 10, py = (pr + 0.5) * 10, jx = (jc + 0.5) * 10, jy = (jr + 0.5) * 10;
    const lift = Math.hypot(jx - px, jy - py) * 0.35 + 4;
    path = `M ${px} ${py} Q ${(px + jx) / 2} ${Math.min(py, jy) - lift} ${jx} ${jy}`;
  }
  return (
    <div role="img" aria-label={remote ? 'Remote' : `Job in ${jobState ?? 'unknown'}, profile in ${profileState ?? 'unknown'}`} className="relative w-full">
      <div className="grid aspect-[12/8] w-full gap-[2px]" style={{ gridTemplateColumns: 'repeat(12, 1fr)', gridTemplateRows: 'repeat(8, 1fr)' }}>
        {Object.entries(US_TILES).map(([st, [r, c]]) => {
          let bg = base;
          let label = '';
          let lightAt: number | null = null;
          if (remote) bg = onDark ? 'rgba(16,185,129,.55)' : 'color-mix(in srgb, #10b981 45%, transparent)';
          else if (st === jobState && st === profileState) { bg = '#10b981'; label = st; lightAt = waveEnd - 40; }
          else if (st === jobState) { bg = '#2563eb'; label = st; lightAt = jobAt; }
          else if (st === profileState) { bg = profileColor; label = st; lightAt = waveEnd - 80; }
          const wave = `ppWave 350ms ease-out ${at + (r + c) * (remote ? 22 : 14)}ms both`;
          const style: CSSProperties = { gridRow: r + 1, gridColumn: c + 1, background: bg };
          if (animate && (waveOn || lightAt != null)) {
            const light = lightAt != null ? `ppLightUp 500ms ease-out ${lightAt}ms both` : '';
            style.animation = [waveOn ? wave : '', light].filter(Boolean).join(', ');
            if (lightAt != null) Object.assign(style, { '--pp-base': base, '--pp-lit': bg });
          }
          return (
            <i key={st} className={`relative grid place-items-center rounded-[3px] text-[7px] font-extrabold not-italic text-white ${label ? '' : 'overflow-hidden'} ${onDark ? '' : 'pp-map'}`} style={style}>
              {label}
              {animate && lightAt != null && st === jobState && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[3px]" style={{ background: bg, animation: `ppPing 900ms ease-out ${lightAt + 380}ms 2 both` }} />
              )}
            </i>
          );
        })}
      </div>
      {route && (
        <svg viewBox="0 0 120 80" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <path d={path} pathLength={1} fill="none" stroke={onDark ? '#fff' : '#2563eb'} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke"
            strokeDasharray="1" strokeDashoffset={animate ? 1 : 0} style={animate ? { animation: `ppDraw 480ms ease-in-out ${waveEnd + 60}ms both` } : undefined} opacity={0.9} />
        </svg>
      )}
    </div>
  );
}

// What the job pays against what the profile asks, on one slider.
// Animated: the profile's rate drops in, then the job's rate slides over
// from it to where it really is, so the gap is the movement.
export function RateBar({ job, mine, mineLabel, mineColor, onDark = false, animate = false, at = 0 }: {
  job: number | null; mine: number | null; mineLabel: string; mineColor: string; onDark?: boolean; animate?: boolean; at?: number;
}) {
  const track = onDark ? 'rgba(255,255,255,.18)' : 'var(--pp-map-tile)';
  if (job == null) return <div className="px-2 py-5"><div className="h-2 rounded-full" style={{ background: `repeating-linear-gradient(90deg, ${track} 0 8px, transparent 8px 14px)` }} /></div>;
  const values = [job, mine ?? job];
  const lo = Math.min(40, Math.min(...values) - 10);
  const hi = Math.max(95, Math.max(...values) + 10);
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const ring = onDark ? '#0b0f1a' : 'var(--pp-surface)';
  return (
    <div className="px-2 pb-[18px] pt-5" role="img" aria-label={`Pays $${job}${mine ? `, asks $${mine}` : ''}`}>
      <div className="relative h-2 rounded-full" style={{ background: track }}>
        {mine != null && <span className="absolute inset-y-0 rounded-full" style={{ left: pos(mine - 5), width: `calc(${pos(mine + 5)} - ${pos(mine - 5)})`, background: 'color-mix(in srgb, #10b981 45%, transparent)', ...anim(animate, 'ppFadeIn', 400, at + 150, 'ease-out') }} />}
        <span className="absolute top-1/2 z-10 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600"
          style={{ left: pos(job), border: `3px solid ${ring}`, ...(animate ? { '--pp-from': pos(mine ?? job), '--pp-to': pos(job), animation: `ppSlideLeft 750ms cubic-bezier(.2,.8,.2,1) ${at + 450}ms both` } as CSSProperties : {}) }}>
          <em className={`absolute bottom-[17px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[11.5px] font-extrabold not-italic ${onDark ? 'text-blue-300' : 'text-blue-700 dark:text-blue-300'}`} style={anim(animate, 'ppFadeIn', 300, at + 950, 'ease-out')}>${Math.round(job)}</em>
        </span>
        {mine != null && (
          <span className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: pos(mine), background: mineColor, border: `3px solid ${ring}`, ...anim(animate, 'ppFadeIn', 300, at + 200, 'ease-out') }}>
            <em className={`absolute left-1/2 top-[17px] -translate-x-1/2 whitespace-nowrap text-[11.5px] font-extrabold not-italic ${onDark ? 'text-white/85' : 'text-gray-600 dark:text-slate-300'}`}>{mineLabel} ${Math.round(mine)}</em>
          </span>
        )}
      </div>
    </div>
  );
}

// Visas the job accepts, the profile's own one ringed.
export function VisaRow({ accepted, mine }: { accepted: string[]; mine: string | null }) {
  if (accepted.length === 0) {
    return <p className="text-[12.5px] text-gray-500 dark:text-slate-400">The post doesn&apos;t say which visas it accepts{mine ? `. Profile: ${mine}` : ''}.</p>;
  }
  const shown = VISA_ORDER.filter((v) => accepted.includes(v) || v === mine || ['USC', 'GC', 'H1B', 'H4 EAD', 'OPT'].includes(v));
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((v) => {
        const ok = accepted.includes(v);
        return (
          <span key={v} title={ok ? 'Accepted' : 'Not accepted'}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-extrabold ${ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-gray-100 text-gray-400 line-through dark:bg-white/5 dark:text-slate-500'} ${v === mine ? 'ring-2 ring-emerald-500' : ''}`}>
            {v === mine && <Check size={11} strokeWidth={3} />}{v}
          </span>
        );
      })}
    </div>
  );
}

function EngStat({ icon: Icon, value, label, on, at, tone }: { icon: typeof Eye; value: number; label: string; on: boolean; at: number; tone: string }) {
  const shown = useCountUp(value, on, 600, at);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-bold tabular-nums ${tone}`} style={anim(on, 'ppPop', 320, at)}>
      <Icon size={13} strokeWidth={2.4} />{shown} {label}
    </span>
  );
}

// Who else is on this post: accounts that viewed, applied, saved and shared
// it. A busy post is flagged Trending; a quiet one invites you to go first.
export function EngagementRow({ eng, onDark = false, animate = false, at = 0, gap = 350 }: {
  eng: { views: number; applies: number; saves: number; shares: number } | undefined; onDark?: boolean; animate?: boolean; at?: number; gap?: number;
}) {
  const e = eng ?? { views: 0, applies: 0, saves: 0, shares: 0 };
  const stats = ([
    [Eye, e.views, 'viewed', onDark ? 'bg-white/10 text-white/90' : 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-slate-200'],
    [Send, e.applies, 'applied', onDark ? 'bg-emerald-500/20 text-emerald-200' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'],
    [Bookmark, e.saves, 'saved', onDark ? 'bg-blue-500/20 text-blue-200' : 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'],
    [Share2, e.shares, 'shared', onDark ? 'bg-violet-500/20 text-violet-200' : 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'],
  ] as const).filter(([, n]) => n > 0);
  const hot = e.views >= 5 || e.applies >= 2;
  if (stats.length === 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-bold ${onDark ? 'bg-amber-400/20 text-amber-200' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'}`} style={anim(animate, 'ppPop', 320, at)}>
          <Sparkles size={13} />Be the first to apply
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {hot && (
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-extrabold ${onDark ? 'bg-orange-500/25 text-orange-200' : 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300'}`}
          style={anim(animate, 'ppPop', 360, at + stats.length * gap)}>
          <Flame size={13} fill="currentColor" />Trending
        </span>
      )}
      {stats.map(([icon, n, label, tone], i) => <EngStat key={label} icon={icon} value={n} label={label} on={animate} at={at + i * gap} tone={tone} />)}
    </div>
  );
}

const ASK_LABEL: Record<string, string> = { rate: 'Ask rate', visa: 'Ask visa', location: 'Ask location' };
// Ask the poster for what the post leaves out. Once asked, it says so.
export function AskChips({ missing, asked, onAsk, onDark = false }: {
  missing: Array<'rate' | 'visa' | 'location'>; asked: string[]; onAsk: (q: 'rate' | 'visa' | 'location') => void; onDark?: boolean;
}) {
  if (missing.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`text-[12px] font-semibold ${onDark ? 'text-white/60' : 'text-gray-500 dark:text-slate-400'}`}>Not in the post:</span>
      {missing.map((q) => {
        const done = asked.includes(q);
        return (
          <button key={q} type="button" disabled={done} onClick={(e) => { e.stopPropagation(); onAsk(q); }}
            title={done ? 'Asked. The reply comes to your email.' : 'We email the poster that you asked, with your email so they can reply'}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold ${done
              ? (onDark ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-400')
              : (onDark ? 'bg-white text-gray-900 hover:bg-white/90' : 'bg-blue-600 text-white hover:bg-blue-700')}`}>
            {done ? <Check size={12} strokeWidth={3} /> : null}{done ? `Asked ${q}` : ASK_LABEL[q]}
          </button>
        );
      })}
    </div>
  );
}
