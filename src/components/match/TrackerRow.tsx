import { Link } from 'react-router-dom';
import { Clock, ExternalLink, Inbox, Mail, XCircle } from 'lucide-react';
import { leadOrg, leadTitle, STATUS_OPTIONS, statusOf, subjectName, type CardItem, type Kind } from '../../lib/today';
import { CompanyLogo, Initials } from './Visuals';

const STEP: Record<string, number> = { applied: 0, replied: 1, interview: 2, placed: 3 };
const PILL: Record<string, string> = {
  applied: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-slate-300',
  replied: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  interview: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  placed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

function when(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// One application: who it went to, for which profile, how far it got, and
// what changed on its own (a reply, the job closing, two quiet weeks).
export default function TrackerRow({ item, kind, onStatus }: { item: CardItem; kind: Kind; onStatus: (status: string) => void }) {
  const lead = item.lead;
  if (!lead) return null;
  const status = statusOf(item);
  const at = STEP[status] ?? -1;
  const signal = item.reply_in_inbox ? { icon: Inbox, text: 'Reply in Inbox', to: '/inbox' }
    : status === 'job_closed' ? { icon: XCircle, text: 'Job post closed' }
    : status === 'no_response' ? { icon: Clock, text: 'No reply in 14 days' } : null;
  const name = subjectName(kind, item.subject);
  return (
    <div className="flex items-center gap-3 border-t border-gray-100 px-3 py-2.5 first:border-0 dark:border-white/5">
      <span className="relative inline-flex shrink-0">
        <CompanyLogo name={leadOrg(lead)} avatar={lead.avatar} domain={lead.logo_domain} size={38} round={Boolean(lead.avatar)} />
        <span title={item.how === 'site' ? 'Applied on their site' : kind === 'job' ? 'Asked for the resume' : 'Applied by email'}
          className={`absolute -bottom-1 -right-1 grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-white text-white dark:border-[#20242a] ${item.how === 'site' ? 'bg-emerald-600' : 'bg-blue-600'}`}>
          {item.how === 'site' ? <ExternalLink size={9} strokeWidth={3} /> : <Mail size={9} strokeWidth={3} />}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <Link to={`/${lead.kind === 'job' ? 'job' : 'hotlist'}/${lead.id}`} className="block truncate text-[14px] font-bold hover:underline">{leadTitle(lead)}</Link>
        <p className="flex items-center gap-1.5 truncate text-[12px] text-gray-500 dark:text-slate-400">
          <span className="truncate">{leadOrg(lead)}</span>·<Initials name={name} id={item.subject_id} size={16} /><span className="truncate">{name}</span>·<span className="shrink-0">{when(item.applied_at)}</span>
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="flex gap-[3px]" role="img" aria-label={STATUS_OPTIONS.find((o) => o.value === status)?.label}>
            {[0, 1, 2, 3].map((x) => <i key={x} className={`h-1 w-[18px] rounded-sm ${x <= at ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-white/10'}`} />)}
          </span>
          {signal && (signal.to ? (
            <Link to={signal.to} className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 text-[11px] font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"><signal.icon size={11} />{signal.text}</Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 text-[11px] font-bold text-gray-500 dark:bg-white/10 dark:text-slate-400"><signal.icon size={11} />{signal.text}</span>
          ))}
        </div>
      </div>
      <select value={status} onChange={(e) => onStatus(e.target.value)} aria-label="Status"
        className={`shrink-0 cursor-pointer appearance-none rounded-full border-0 py-1 pl-2.5 pr-6 text-[12px] font-bold ${PILL[status] ?? 'bg-gray-100 text-gray-400 line-through dark:bg-white/10'}`}
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238a919c' stroke-width='1.6'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '9px' }}>
        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
