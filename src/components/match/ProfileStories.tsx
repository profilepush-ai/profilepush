import { Plus } from 'lucide-react';
import { hashColor } from '../../lib/match-fit';
import { subjectName, type Kind, type Subject } from '../../lib/today';

// The profiles (or jobs) on Today as status circles, like WhatsApp: the name
// inside, and around it a ring with a segment for each match: red while it
// has under 3 hours left, green while it's new, grey once it's been watched.
// The badge is how many matches there are.

export type StoryCounts = { total: number; fresh: number; seen: number; expiring: number };

const MAX_SEGMENTS = 36;
const COLORS = { expiring: '#ef4444', fresh: '#10b981', seen: '#cbd5e1' } as const;

// The segments' colours in order (red, then green, then grey); past 36
// matches each segment stands for several, shared out in proportion.
function segments(c: StoryCounts): string[] {
  const parts: Array<[number, string]> = [[c.expiring, COLORS.expiring], [c.fresh, COLORS.fresh], [c.seen, COLORS.seen]];
  const total = c.expiring + c.fresh + c.seen;
  if (!total) return [];
  if (total <= MAX_SEGMENTS) return parts.flatMap(([n, color]) => Array<string>(n).fill(color));
  const shares = parts.map(([n]) => (n ? Math.max(1, Math.round((n / total) * MAX_SEGMENTS)) : 0));
  // Keep the sum at 36, taking any rounding from the biggest share.
  const biggest = shares.indexOf(Math.max(...shares));
  shares[biggest] += MAX_SEGMENTS - shares.reduce((a, b) => a + b, 0);
  return parts.flatMap(([, color], i) => Array<string>(Math.max(0, shares[i])).fill(color));
}

function Ring({ colors, size }: { colors: string[]; size: number }) {
  const n = colors.length;
  const gap = n > 1 ? Math.min(3, 60 / n) : 0;
  const seg = n ? 100 / n - gap : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true" className="absolute inset-0 -rotate-90">
      {n === 0 && <circle cx="30" cy="30" r="27.5" fill="none" stroke="#e5e7eb" strokeWidth="3" />}
      {colors.map((color, i) => (
        <circle key={i} cx="30" cy="30" r="27.5" fill="none" stroke={color} strokeWidth="3" strokeLinecap={n > 24 ? 'butt' : 'round'} pathLength={100}
          strokeDasharray={`${seg} ${100 - seg}`} strokeDashoffset={-(i * 100) / n - gap / 2} />
      ))}
    </svg>
  );
}

function Story({ on, counts, onClick, title, children, fill }: {
  on: boolean; counts: StoryCounts; onClick: () => void; title: string; children: React.ReactNode; fill: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={title}
      className={`relative h-[54px] w-[54px] shrink-0 rounded-full transition-transform active:scale-95 ${on ? 'scale-[1.06]' : ''}`}>
      <Ring colors={segments(counts)} size={54} />
      <span className={`absolute inset-[6px] grid place-items-center overflow-hidden rounded-full px-1 text-center ${on ? 'ring-[2.5px] ring-[#2563EB] ring-offset-1' : ''}`} style={{ background: fill }}>
        {children}
      </span>
      {counts.total > 0 && (
        <span className="absolute -bottom-0.5 -right-0.5 min-w-[20px] rounded-full bg-[#0B1A3A] px-1 text-center text-[10px] font-extrabold leading-[18px] tabular-nums text-white ring-2 ring-white">
          {counts.total}
        </span>
      )}
    </button>
  );
}

// What fits inside the circle, enough to tell profiles apart: the person's
// first name, else the title's key word ("Python" from "Senior Python Data
// Engineer"), with years and visa (or a job's city) underneath.
const FILLER = /^(senior|sr\.?|junior|jr\.?|lead|principal|staff|mid|level|entry|associate|the|a|an|and|of|for|with|in|developer|engineer|consultant|analyst|specialist|administrator|admin|manager|full|stack)$/i;
function storyLabel(kind: Kind, s: Subject): { main: string; sub: string | null } {
  const years = s.years ? `${Math.round(Number(s.years))}y` : null;
  if (s.name) return { main: s.name.trim().split(/\s+/)[0], sub: years };
  const words = (s.title ?? '').split(/[\s/,()|–-]+/).filter(Boolean);
  const main = words.find((w) => !FILLER.test(w)) ?? words[0] ?? subjectName(kind, s);
  const sub = kind === 'job' ? (s.location ?? '').split(',')[0] || null : [years, s.visa].filter(Boolean).join(' ') || null;
  return { main, sub };
}

export default function ProfileStories({ kind, subjects, filter, onFilter, countsFor, onAdd }: {
  kind: Kind; subjects: Subject[]; filter: string; onFilter: (id: string) => void;
  /** One profile's matches (or 'all'): expiring within 3 hours, new, and watched. */
  countsFor: (id: string | 'all') => StoryCounts;
  onAdd?: () => void;
}) {
  const all = countsFor('all');
  return (
    <div className="-mx-3 flex gap-2.5 overflow-x-auto px-3 py-1 [scrollbar-width:none]" style={{ touchAction: 'pan-x' }} role="group" aria-label={kind === 'hotlist' ? 'Profiles' : 'Jobs'}>
      <Story on={filter === 'all'} counts={all} onClick={() => onFilter('all')} fill="#ffffff"
        title={`All: ${all.total} matches, ${all.fresh} new, ${all.expiring} leaving within 3 hours`}>
        <span className="flex flex-col items-center leading-none">
          {/* The ProfilePush mark. */}
          <svg width="20" height="18" viewBox="0 0 26 24" aria-hidden="true">
            <circle cx="5" cy="7.6" r="3.6" fill="#FACC15" /><circle cx="5" cy="16.4" r="3.6" fill="#F97316" />
            <polyline points="13,4.5 20,12 13,19.5" fill="none" stroke="#2563EB" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <b className="mt-0.5 text-[10px] font-extrabold text-[#0B1A3A]">All</b>
        </span>
      </Story>
      {subjects.map((s) => {
        const c = countsFor(s.id);
        const label = storyLabel(kind, s);
        return (
          <Story key={s.id} on={filter === s.id} counts={c} onClick={() => onFilter(s.id)} fill={hashColor(s.id)}
            title={`${subjectName(kind, s)}: ${c.total} matches, ${c.fresh} new, ${c.expiring} leaving within 3 hours`}>
            <span className="flex max-w-full flex-col items-center leading-[1.05] text-white">
              <b className={`max-w-full truncate font-extrabold ${label.main.length > 7 ? 'text-[9px]' : 'text-[11px]'}`}>{label.main}</b>
              {label.sub && <small className="max-w-full truncate text-[8px] font-bold opacity-85">{label.sub}</small>}
            </span>
          </Story>
        );
      })}
      {onAdd && (
        <button type="button" onClick={onAdd} className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-full border-2 border-dashed border-gray-300 bg-white/70 text-gray-500"
          title={kind === 'hotlist' ? 'Add a profile' : 'Add a job'} aria-label={kind === 'hotlist' ? 'Add a profile' : 'Add a job'}>
          <Plus size={20} />
        </button>
      )}
    </div>
  );
}
