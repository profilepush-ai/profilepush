import { Bookmark, Eye, ExternalLink, FileText, Send, Share2, X } from 'lucide-react';
import { agoLabel } from '../../lib/match-fit';
import { fitFor, leadOrg, leadTitle, subjectName, type CardItem, type Kind, type Subject } from '../../lib/today';
import { CompanyLogo, FitBadges, FitRing, Initials } from './Visuals';

// One match as a picture: who posted it, the match ring, and four badges for
// skills, visa, location and rate. Apply (or Ask Resume, for vendors) is the
// one big button.
export default function MatchCard({ item, kind, subject, selected, showFor, onOpen, onApply, onSave, onShare, onDismiss, onSubject }: {
  item: CardItem; kind: Kind; subject: Subject | undefined; selected?: boolean; showFor: boolean;
  onOpen: () => void; onApply: () => void; onSave: () => void; onShare: () => void; onDismiss?: () => void; onSubject: () => void;
}) {
  const lead = item.lead;
  if (!lead) return null;
  const fit = fitFor(kind, subject, lead);
  const saved = Boolean(item.saved_at);
  const seen = item.stage === 'new' && !saved && Boolean(item.viewed_at);
  const site = kind === 'hotlist' && item.lead?.source === 'career_site';
  const iconBtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5 dark:hover:text-slate-200';
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      aria-label={leadTitle(lead)}
      className={`flex cursor-pointer flex-col gap-2 rounded-2xl border bg-white px-3 pb-2 pt-3 transition-[border-color,box-shadow,opacity] dark:bg-[#20242a] ${selected
        ? 'border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,.18)]'
        : 'border-gray-200 hover:border-blue-300 dark:border-white/10 dark:hover:border-blue-500/40'} ${seen && !selected ? 'opacity-80 hover:opacity-100' : ''}`}
    >
      <div className="flex items-start gap-3">
        <CompanyLogo name={leadOrg(lead)} avatar={lead.avatar} domain={lead.logo_domain} round={Boolean(lead.avatar)} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[15.5px] font-bold leading-snug text-blue-700 dark:text-blue-300">{leadTitle(lead)}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-gray-600 dark:text-slate-400">
            <span className="truncate">{leadOrg(lead)}</span>
            <span className="text-gray-300 dark:text-slate-600">·</span>
            <span>{agoLabel(lead.posted_at)}</span>
            {seen && <span className="inline-flex items-center gap-0.5 rounded-md bg-gray-100 px-1.5 text-[11px] font-bold text-gray-500 dark:bg-white/10 dark:text-slate-400" title="Opened. Moves to History when its 24 hours in Today are up."><Eye size={11} />Viewed</span>}
          </p>
        </div>
        <FitRing value={item.fit ?? Math.round(item.similarity * 100)} />
      </div>
      <FitBadges fit={fit} />
      <div className="flex items-center gap-1 border-t border-gray-100 pt-2 dark:border-white/5">
        {showFor ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); onSubject(); }} title="Open this profile"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1 pr-1.5 text-left text-[12.5px] font-semibold text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-white">
            <Initials name={subjectName(kind, subject)} id={item.subject_id} size={20} />
            <span className="truncate">for {subjectName(kind, subject)}</span>
          </button>
        ) : <span className="flex-1" />}
        {onDismiss && !saved && (
          <button type="button" className={iconBtn} title="Not a match" aria-label="Not a match" onClick={(e) => { e.stopPropagation(); onDismiss(); }}><X size={17} /></button>
        )}
        <button type="button" className={iconBtn} title="Share" aria-label="Share" onClick={(e) => { e.stopPropagation(); onShare(); }}><Share2 size={17} /></button>
        <button type="button" className={`${iconBtn} ${saved ? '!text-blue-600' : ''}`} title={saved ? 'Saved' : 'Save for later'} aria-label={saved ? 'Saved' : 'Save for later'} aria-pressed={saved}
          onClick={(e) => { e.stopPropagation(); onSave(); }}>
          <Bookmark size={17} fill={saved ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onApply(); }}
          title={kind === 'job' ? 'Ask for the resume' : site ? 'Apply on their site' : 'Apply by email'}
          className={`ml-0.5 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-4 text-[13.5px] font-bold text-white hover:brightness-110 ${site ? 'bg-emerald-600' : 'bg-blue-600'}`}
        >
          {kind === 'job' ? <FileText size={14} /> : site ? <ExternalLink size={14} /> : <Send size={14} />}
          {kind === 'job' ? 'Ask Resume' : 'Apply'}
        </button>
      </div>
    </article>
  );
}
