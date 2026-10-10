import { useState } from 'react';
import { Check, Code2, DollarSign, Globe, MapPin, ShieldCheck } from 'lucide-react';
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

export function FitRing({ value, size = 44, onDark = false }: { value: number; size?: number; onDark?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = v >= 85 ? '#10b981' : v >= 75 ? '#3b82f6' : '#94a3b8';
  return (
    <span
      role="img"
      aria-label={`${v}% match`}
      className={`grid shrink-0 place-items-center rounded-full ${onDark ? '' : 'pp-ring'}`}
      style={{ width: size, height: size, background: `conic-gradient(${color} ${v}%, ${onDark ? 'rgba(255,255,255,.18)' : 'var(--pp-ring-track)'} 0)` }}
    >
      <span
        className={`grid place-items-center rounded-full font-extrabold tabular-nums tracking-tight ${onDark ? 'bg-[#0b0f1a] text-white' : 'bg-white text-gray-900 dark:bg-[#20242a] dark:text-white'}`}
        style={{ width: size - 8, height: size - 8, fontSize: size > 50 ? 15 : 12 }}
      >
        {v}%
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
export function FitBadges({ fit, onDark = false }: { fit: FitSummary; onDark?: boolean }) {
  const tones = onDark ? TONE_DARK : TONE;
  const okSkills = fit.skills.filter((s) => s.ok).length;
  const skillTone: Tone = fit.skills.length === 0 ? 'na' : okSkills / fit.skills.length >= 0.6 ? 'good' : 'warn';
  const visaTone: Tone = fit.visa.ok == null ? 'na' : fit.visa.ok ? 'good' : 'warn';
  const locTone: Tone = fit.location.kind === 'unknown' ? 'na' : fit.location.kind === 'other' ? 'warn' : 'good';
  const badge = 'inline-flex items-center gap-1 rounded-lg px-2 py-[3px] text-[12px] font-bold tabular-nums';
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={`${badge} ${tones[skillTone]}`} title={`${okSkills} of ${fit.skills.length} skills`}>
        <Code2 size={13} strokeWidth={2.4} />{fit.skills.length ? `${okSkills}/${fit.skills.length}` : 'Skills?'}
      </span>
      <span className={`${badge} ${tones[visaTone]}`} title={fit.visa.accepted.length ? `Accepts ${fit.visa.accepted.join(', ')}` : 'Visa not listed'}>
        <ShieldCheck size={13} strokeWidth={2.4} />{fit.visa.mine ?? (fit.visa.accepted[0] || 'Visa?')}
      </span>
      <span className={`${badge} ${tones[locTone]}`} title={fit.location.label}>
        {fit.location.kind === 'remote' ? <Globe size={13} strokeWidth={2.4} /> : <MapPin size={13} strokeWidth={2.4} />}
        <span className="max-w-[9rem] truncate">{fit.location.kind === 'city' ? 'Same city' : fit.location.kind === 'state' ? fit.location.jobState : fit.location.kind === 'remote' ? 'Remote' : fit.location.jobState ?? '–'}</span>
      </span>
      <span className={`${badge} ${tones[fit.rate.kind]}`} title={fit.rate.job ? `$${fit.rate.job}/hr` : 'Rate not listed'}>
        <DollarSign size={13} strokeWidth={2.4} />{fit.rate.job ? Math.round(fit.rate.job) : '–'}
      </span>
    </div>
  );
}

// The job's skills as tiles: lit when the profile has it, dashed when not.
export function SkillTiles({ skills, onDark = false }: { skills: Array<{ name: string; ok: boolean }>; onDark?: boolean }) {
  if (skills.length === 0) return <p className={`text-[12.5px] ${onDark ? 'text-white/70' : 'text-gray-500'}`}>No skills listed in the post.</p>;
  return (
    <div className="flex flex-wrap gap-[7px]">
      {skills.map((s) => {
        const look = skillLook(s.name);
        return s.ok ? (
          <span key={s.name} title={s.name} className="relative flex h-16 w-[60px] flex-col justify-between rounded-[13px] px-[7px] py-1.5 text-white"
            style={{ background: `linear-gradient(150deg, ${look.color}, color-mix(in srgb, ${look.color} 70%, #000))`, boxShadow: `0 2px 6px color-mix(in srgb, ${look.color} 30%, transparent)` }}>
            <b className="text-[21px] font-extrabold leading-none tracking-tight">{look.symbol}</b>
            <small className="truncate text-[9.5px] font-bold opacity-95">{s.name}</small>
            <i className="absolute right-[5px] top-[5px] grid h-[15px] w-[15px] place-items-center rounded-full bg-white not-italic" style={{ color: look.color }}><Check size={9} strokeWidth={4} /></i>
          </span>
        ) : (
          <span key={s.name} title={`${s.name}: not on the profile`} className={`flex h-16 w-[60px] flex-col justify-between rounded-[13px] border-[1.5px] border-dashed px-[7px] py-1.5 opacity-80 ${onDark ? 'border-white/45 text-white/65' : 'border-gray-400 text-gray-500 dark:border-slate-500 dark:text-slate-400'}`}>
            <b className="text-[21px] font-extrabold leading-none tracking-tight">{look.symbol}</b>
            <small className="truncate text-[9.5px] font-bold">{s.name}</small>
          </span>
        );
      })}
    </div>
  );
}

// The job's state and the profile's state on a tile map of the US.
export function UsMap({ jobState, profileState, remote, profileColor, onDark = false }: {
  jobState: string | null; profileState: string | null; remote?: boolean; profileColor: string; onDark?: boolean;
}) {
  return (
    <div role="img" aria-label={remote ? 'Remote' : `Job in ${jobState ?? 'unknown'}, profile in ${profileState ?? 'unknown'}`}
      className="grid aspect-[12/8] w-full gap-[2px]" style={{ gridTemplateColumns: 'repeat(12, 1fr)', gridTemplateRows: 'repeat(8, 1fr)' }}>
      {Object.entries(US_TILES).map(([st, [r, c]]) => {
        let bg = onDark ? 'rgba(255,255,255,.13)' : 'var(--pp-map-tile)';
        let label = '';
        if (remote) bg = onDark ? 'rgba(16,185,129,.55)' : 'color-mix(in srgb, #10b981 45%, transparent)';
        else if (st === jobState && st === profileState) { bg = '#10b981'; label = st; }
        else if (st === jobState) { bg = '#2563eb'; label = st; }
        else if (st === profileState) { bg = profileColor; label = st; }
        return (
          <i key={st} className={`grid place-items-center overflow-hidden rounded-[3px] text-[7px] font-extrabold not-italic text-white ${onDark ? '' : 'pp-map'}`}
            style={{ gridRow: r + 1, gridColumn: c + 1, background: bg }}>{label}</i>
        );
      })}
    </div>
  );
}

// What the job pays against what the profile asks, on one slider.
export function RateBar({ job, mine, mineLabel, mineColor, onDark = false }: {
  job: number | null; mine: number | null; mineLabel: string; mineColor: string; onDark?: boolean;
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
        {mine != null && <span className="absolute inset-y-0 rounded-full" style={{ left: pos(mine - 5), width: `calc(${pos(mine + 5)} - ${pos(mine - 5)})`, background: 'color-mix(in srgb, #10b981 45%, transparent)' }} />}
        <span className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600" style={{ left: pos(job), border: `3px solid ${ring}` }}>
          <em className={`absolute bottom-[17px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[11.5px] font-extrabold not-italic ${onDark ? 'text-blue-300' : 'text-blue-700 dark:text-blue-300'}`}>${Math.round(job)}</em>
        </span>
        {mine != null && (
          <span className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: pos(mine), background: mineColor, border: `3px solid ${ring}` }}>
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
