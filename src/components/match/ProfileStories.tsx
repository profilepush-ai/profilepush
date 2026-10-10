import { Plus } from 'lucide-react';
import { subjectName, type Kind, type Subject } from '../../lib/today';
import { Initials } from './Visuals';

// The profiles (or jobs) on Today as story circles, like WhatsApp status or
// Instagram stories: a brand-coloured ring while one has matches not watched
// yet, grey once they're all seen, blue when it's the one showing. A badge
// says how many are new; the name sits underneath.

const RING_NEW = 'conic-gradient(from 210deg, #FACC15, #F97316, #2563EB, #FACC15)';

function Story({ label, on, unseen, total, onClick, children, title }: {
  label: string; on: boolean; unseen: number; total: number; onClick: () => void; children: React.ReactNode; title: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={title}
      className="flex w-[60px] shrink-0 flex-col items-center gap-1 focus-visible:outline-none">
      <span className="relative grid h-[54px] w-[54px] place-items-center rounded-full p-[2.5px] transition-transform active:scale-95"
        style={{ background: on ? '#2563EB' : unseen ? RING_NEW : '#d1d5db' }}>
        <span className="grid h-full w-full place-items-center rounded-full bg-white p-[2px]">{children}</span>
        {(unseen > 0 || total > 0) && (
          <span className={`absolute -bottom-0.5 -right-1 min-w-[20px] rounded-full px-1 text-center text-[10.5px] font-extrabold leading-[18px] tabular-nums ring-2 ring-white ${unseen ? 'bg-[#2563EB] text-white' : 'bg-gray-200 text-gray-600'}`}>
            {unseen || total}
          </span>
        )}
      </span>
      <span className={`w-full truncate text-center text-[11px] leading-tight ${on ? 'font-extrabold text-[#2563EB]' : unseen ? 'font-bold text-gray-900' : 'font-semibold text-gray-500'}`}>{label}</span>
    </button>
  );
}

// A short name under the circle: the person's first name, or the job title.
const shortName = (kind: Kind, s: Subject) => (s.name ? s.name.trim().split(/\s+/)[0] : subjectName(kind, s));

export default function ProfileStories({ kind, subjects, filter, onFilter, countsFor, onAdd }: {
  kind: Kind; subjects: Subject[]; filter: string; onFilter: (id: string) => void;
  /** Matches for one profile (or 'all'): how many in all and how many not watched yet. */
  countsFor: (id: string | 'all') => { total: number; unseen: number };
  onAdd?: () => void;
}) {
  const all = countsFor('all');
  return (
    <div className="-mx-3 flex gap-2.5 overflow-x-auto px-3 pb-0.5 pt-0.5 [scrollbar-width:none]" style={{ touchAction: 'pan-x' }} role="group" aria-label={kind === 'hotlist' ? 'Profiles' : 'Jobs'}>
      <Story label="All" on={filter === 'all'} unseen={all.unseen} total={all.total} onClick={() => onFilter('all')} title={`All matches: ${all.total}`}>
        {/* The ProfilePush mark. */}
        <svg width="26" height="24" viewBox="0 0 26 24" aria-hidden="true">
          <circle cx="5" cy="7.6" r="3.6" fill="#FACC15" /><circle cx="5" cy="16.4" r="3.6" fill="#F97316" />
          <polyline points="13,4.5 20,12 13,19.5" fill="none" stroke="#2563EB" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Story>
      {subjects.map((s) => {
        const c = countsFor(s.id);
        return (
          <Story key={s.id} label={shortName(kind, s)} on={filter === s.id} unseen={c.unseen} total={c.total} onClick={() => onFilter(s.id)}
            title={`${subjectName(kind, s)}: ${c.total} matches${c.unseen ? `, ${c.unseen} new` : ''}`}>
            <Initials name={subjectName(kind, s)} id={s.id} size={44} />
          </Story>
        );
      })}
      {onAdd && (
        <button type="button" onClick={onAdd} className="flex w-[60px] shrink-0 flex-col items-center gap-1" title={kind === 'hotlist' ? 'Add a profile' : 'Add a job'}>
          <span className="grid h-[54px] w-[54px] place-items-center rounded-full border-2 border-dashed border-gray-300 bg-white/70 text-gray-500"><Plus size={20} /></span>
          <span className="text-[11px] font-semibold text-gray-500">Add</span>
        </button>
      )}
    </div>
  );
}
