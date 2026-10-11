import { ChevronDown } from 'lucide-react';
import { leadOrg, leadTitle, pictureFor, STATUS_OPTIONS, statusOf, subjectName, type CardItem, type Kind } from '../../lib/today';
import { dayOf, fitOf } from '../../lib/sheet';

// Tracker and History on a phone: one card per match instead of the sheet's
// columns (which don't fit). The picture, the job, who it's for and when, and
// on the right its status (tap to change) or its match score.

const DOT: Record<string, string> = {
  applied: '#94a3b8', replied: '#2563eb', interview: '#7c3aed', placed: '#059669',
  not_selected: '#ef4444', no_response: '#cbd5e1', job_closed: '#cbd5e1',
};

export default function MatchList({ items, kind, mode, dateOf, onOpen, onStatus, viewerId }: {
  items: CardItem[]; kind: Kind; mode: 'tracker' | 'history'; dateOf: (i: CardItem) => string | null; viewerId?: string;
  onOpen: (item: CardItem) => void; onStatus?: (item: CardItem, status: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {items.filter((i) => i.lead).map((item, n) => {
        const lead = item.lead!;
        const pic = pictureFor(lead, viewerId);
        const status = statusOf(item);
        const closed = item.stage === 'closed';
        const label = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? 'Applied';
        return (
          <li key={item.card_id} className={`flex items-center gap-3 rounded-2xl bg-white p-2.5 ring-1 ring-gray-200 ${closed ? 'opacity-60' : ''}`}
            style={{ animation: `ppFadeUp .35s ease-out ${Math.min(n, 12) * 30}ms both` }}>
            <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              {pic
                ? <img src={pic} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-xl object-cover object-[50%_18%]" />
                : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gray-100 text-[18px] font-extrabold text-gray-400">{leadOrg(lead).trim()[0]?.toUpperCase()}</span>}
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[14.5px] font-bold text-gray-900">{leadTitle(lead)}</b>
                <span className="block truncate text-[12.5px] text-gray-500">{[leadOrg(lead), lead.location].filter(Boolean).join(' · ')}</span>
                <span className="block truncate text-[11.5px] text-gray-400">for {subjectName(kind, item.subject)}{dateOf(item) ? ` · ${dayOf(dateOf(item))}` : ''}{item.notes ? ` · ${item.notes}` : ''}</span>
              </span>
            </button>
            {mode === 'tracker' && onStatus ? (
              // A chip that opens the phone's own picker.
              <label className="relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-gray-100 pl-2.5 pr-2 text-[12px] font-bold text-gray-800">
                <i className="h-2 w-2 rounded-full" style={{ background: DOT[status] ?? '#cbd5e1' }} />{label}<ChevronDown size={13} className="text-gray-400" />
                <select value={status} onChange={(e) => onStatus(item, e.target.value)} aria-label="Status" className="absolute inset-0 cursor-pointer opacity-0">
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ) : (
              <b className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[12.5px] font-extrabold tabular-nums text-blue-700">{fitOf(item)}%</b>
            )}
          </li>
        );
      })}
    </ul>
  );
}
