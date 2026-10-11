import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { leadOrg, leadTitle, pictureFor, STATUS_OPTIONS, statusOf, subjectName, type CardItem, type Kind } from '../../lib/today';
import { dayOf, fitOf, postUrl, rateOf, type SheetMode } from '../../lib/sheet';

// Tracker and History as a sheet: thin grid lines, a sticky header, row
// numbers, one line per match. Status and Notes are edited in the cell.
// Wide on phones: it scrolls sideways with the job pinned.

const DOT: Record<string, string> = {
  applied: '#94a3b8', replied: '#2563eb', interview: '#7c3aed', placed: '#059669',
  not_selected: '#ef4444', no_response: '#cbd5e1', job_closed: '#cbd5e1',
};

function NotesCell({ item, onSave }: { item: CardItem; onSave: (notes: string) => void }) {
  const [value, setValue] = useState(item.notes ?? '');
  const save = () => { if (value !== (item.notes ?? '')) onSave(value); };
  return (
    <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setValue(item.notes ?? ''); (e.target as HTMLInputElement).blur(); } }}
      placeholder="Add a note" aria-label="Notes"
      className="h-full w-full bg-transparent px-2 text-[13px] outline-none placeholder:text-gray-300 focus:bg-white focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-600 dark:placeholder:text-slate-600 dark:focus:bg-[#1B1D21]" />
  );
}

export default function MatchSheet({ items, kind, mode, dateLabel, dateOf, onOpen, onStatus, onNotes, viewerId }: {
  items: CardItem[]; kind: Kind; mode: SheetMode; dateLabel: string; dateOf: (i: CardItem) => string | null; viewerId?: string;
  onOpen: (item: CardItem) => void; onStatus?: (item: CardItem, status: string) => void; onNotes?: (item: CardItem, notes: string) => void;
}) {
  // The picture, bigger, beside the row being hovered (outside the scroll box).
  const [peek, setPeek] = useState<{ url: string; x: number; y: number } | null>(null);
  const head = 'sticky top-0 z-10 h-8 border-b border-r border-gray-200 bg-[#f8f9fa] px-2 text-left text-[12px] font-semibold text-gray-600 dark:border-white/10 dark:bg-[#26292f] dark:text-slate-300';
  const cell = 'h-9 max-w-[220px] truncate border-b border-r border-gray-100 px-2 text-[13px] dark:border-white/5';
  const num = 'sticky left-0 z-[5] w-10 border-b border-r border-gray-200 bg-[#f8f9fa] text-center text-[11.5px] tabular-nums text-gray-400 dark:border-white/10 dark:bg-[#26292f]';
  const first = 'sticky left-10 z-[5] max-w-[280px] bg-white shadow-[1px_0_0_rgba(0,0,0,0.06)] dark:bg-[#20242a]';
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#20242a]">
      <table className="w-full min-w-[1080px] border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={`${head} sticky left-0 z-20 w-10`} aria-label="Row" />
            <th className={`${head} left-10 z-20`}>Job</th>
            <th className={head}>Company</th>
            <th className={head}>{kind === 'hotlist' ? 'Profile' : 'Your job'}</th>
            {mode === 'history' && <th className={`${head} text-right`}>Fit</th>}
            <th className={head}>Location</th>
            <th className={head}>Rate</th>
            <th className={head}>{dateLabel}</th>
            {mode === 'tracker' && <th className={head}>Via</th>}
            {mode === 'tracker' && <th className={head}>Status</th>}
            {mode === 'tracker' && <th className={`${head} w-[240px]`}>Notes</th>}
            <th className={`${head} w-10`} aria-label="Link" />
          </tr>
        </thead>
        <tbody>
          {items.filter((i) => i.lead).map((item, n) => {
            const lead = item.lead!;
            const status = statusOf(item);
            const closed = item.stage === 'closed';
            return (
              <tr key={item.card_id} className={`hover:bg-blue-50/40 dark:hover:bg-white/[0.03] ${closed ? 'text-gray-400 dark:text-slate-500' : ''}`}>
                <td className={num}>{n + 1}</td>
                <td className={`${cell} ${first}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    {/* The post's AI picture; hover for a bigger look. */}
                    {(() => {
                      const pic = pictureFor(lead, viewerId);
                      return pic ? (
                        <img src={pic} alt="" loading="lazy" className="h-7 w-7 shrink-0 cursor-zoom-in rounded-md object-cover object-[50%_25%]"
                          onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPeek({ url: pic, x: r.right + 10, y: Math.max(8, Math.min(window.innerHeight - 248, r.top - 104)) }); }}
                          onMouseLeave={() => setPeek(null)} />
                      ) : <span className="h-7 w-7 shrink-0 rounded-md bg-gray-100 dark:bg-white/5" />;
                    })()}
                    <button type="button" onClick={() => onOpen(item)} className="min-w-0 truncate text-left font-semibold text-blue-700 hover:underline dark:text-blue-300" title={leadTitle(lead)}>{leadTitle(lead)}</button>
                  </span>
                </td>
                <td className={cell} title={leadOrg(lead)}>{leadOrg(lead)}</td>
                <td className={cell}>{subjectName(kind, item.subject)}</td>
                {mode === 'history' && <td className={`${cell} text-right font-semibold tabular-nums`}>{fitOf(item)}%</td>}
                <td className={cell} title={lead.location ?? ''}>{lead.location ?? ''}</td>
                <td className={`${cell} tabular-nums`}>{rateOf(item)}</td>
                <td className={`${cell} tabular-nums`}>{dayOf(dateOf(item))}</td>
                {mode === 'tracker' && <td className={cell}>{item.how === 'site' ? 'Their site' : kind === 'job' ? 'Asked resume' : 'Email'}</td>}
                {mode === 'tracker' && (
                  <td className={`${cell} p-0`}>
                    <label className="flex h-full items-center gap-1.5 px-2">
                      <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[status] ?? '#cbd5e1' }} />
                      <select value={status} onChange={(e) => onStatus?.(item, e.target.value)} aria-label="Status"
                        className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-[13px] font-semibold outline-none">
                        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                  </td>
                )}
                {mode === 'tracker' && <td className={`${cell} max-w-[240px] p-0`}>{onNotes && <NotesCell item={item} onSave={(v) => onNotes(item, v)} />}</td>}
                <td className={`${cell} text-center`}>
                  <a href={postUrl(item)} target="_blank" rel="noreferrer" title="Open the post" className="inline-grid h-6 w-6 place-items-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10"><ExternalLink size={13} /></a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {peek && <img src={peek.url} alt="" aria-hidden="true" className="pointer-events-none fixed z-50 h-[240px] w-[160px] rounded-xl object-cover shadow-2xl ring-1 ring-black/10" style={{ left: peek.x, top: peek.y }} />}
    </div>
  );
}
