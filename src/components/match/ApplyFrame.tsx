import { useState } from 'react';
import { Check, Copy, ExternalLink, MousePointerClick, X } from 'lucide-react';
import { leadOrg, leadTitle, strings, subjectName, type CardItem, type Kind, type Subject } from '../../lib/today';
import { CompanyLogo } from './Visuals';
import { openApplyWindow } from './useMatchActions';

// A career site's application in a ProfilePush popup, with the profile's
// details one tap away for filling in their form. Sites that allow it show
// inside the popup; the rest (most career sites block being shown inside
// another site) open in a small window beside it, and the popup keeps the
// details to copy across.
export default function ApplyFrame({ item, url, kind, subject, embed, onClose }: {
  item: CardItem; url: string; kind: Kind; subject: Subject | undefined; embed: boolean; onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const lead = item.lead!;
  const name = subjectName(kind, subject);
  const resume = subject?.resumes?.find((r) => r.is_default) ?? subject?.resumes?.[0];
  const rows: Array<[string, string | null | undefined]> = [
    ['Name', subject?.name],
    ['Role', subject?.title],
    ['Visa', subject?.visa],
    ['Location', strings(subject?.locations)[0]],
    ['Rate', subject?.rate_min ? `$${subject.rate_min}${subject.rate_max && subject.rate_max !== subject.rate_min ? `-${subject.rate_max}` : ''}/hr` : null],
    ['Experience', subject?.years ? `${Math.round(subject.years)} years` : null],
    ['Skills', strings(subject?.skills).join(', ')],
    ['Resume', resume?.url],
  ];
  const copy = (label: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => { setCopied(label); setTimeout(() => setCopied(null), 1200); }).catch(() => {});
  };
  return (
    <div className="fixed inset-0 z-[88] flex items-stretch justify-center bg-slate-900/50 lg:p-6" role="dialog" aria-label={`Apply on ${leadOrg(lead)}'s site`}>
      <div className="flex w-full max-w-[1200px] flex-col overflow-hidden bg-white pt-[env(safe-area-inset-top)] shadow-2xl dark:bg-[#20242a] lg:rounded-2xl lg:pt-0">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-gray-200 px-3 py-2 dark:border-white/10">
          <CompanyLogo name={leadOrg(lead)} avatar={lead.avatar} domain={lead.logo_domain} size={34} round={Boolean(lead.avatar)} />
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[14px]">{leadTitle(lead)}</b>
            <small className="block truncate text-[12px] text-gray-500">Applying for {name} on {leadOrg(lead)}&apos;s site</small>
          </div>
          <a href={url} target="_blank" rel="noreferrer" title="Open in a new tab" className="grid h-9 w-9 place-items-center rounded-[10px] text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5"><ExternalLink size={17} /></a>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-[10px] text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5"><X size={20} /></button>
        </div>
        {embed ? (
          <iframe title={`${leadOrg(lead)} application`} src={url} className="min-h-0 w-full flex-1 border-0 bg-white"
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
            <CompanyLogo name={leadOrg(lead)} avatar={lead.avatar} domain={lead.logo_domain} size={64} round={Boolean(lead.avatar)} />
            <div>
              <h2 className="text-[20px] font-extrabold">{leadOrg(lead)}&apos;s application is open beside this</h2>
              <p className="mx-auto mt-1 max-w-[46ch] text-[14px] text-gray-500 dark:text-slate-400">Fill in their form there. Tap a detail below to copy it, then paste it into their form.</p>
            </div>
            <button type="button" onClick={() => openApplyWindow(url)}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-[14px] font-bold text-white hover:bg-emerald-700">
              <MousePointerClick size={17} />Show their application
            </button>
            <div className="grid w-full max-w-[520px] grid-cols-2 gap-2 text-left">
              {rows.filter(([, v]) => v).map(([label, value]) => (
                <button key={label} type="button" onClick={() => copy(label, value!)} title={value!}
                  className="flex min-w-0 flex-col rounded-xl border border-gray-200 px-3 py-2 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                  <span className="flex items-center gap-1 text-[11.5px] font-bold text-gray-500 dark:text-slate-400">
                    {copied === label ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}{copied === label ? 'Copied' : label}
                  </span>
                  <span className="truncate text-[13.5px] font-semibold">{value}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2 border-t border-gray-200 px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] dark:border-white/10">
          <div className={`min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] ${embed ? 'flex' : 'hidden'}`} aria-label="Copy details into the form">
            {rows.filter(([, v]) => v).map(([label, value]) => (
              <button key={label} type="button" onClick={() => copy(label, value!)} title={value!}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5">
                {copied === label ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}{label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="h-9 shrink-0 rounded-[10px] bg-emerald-600 px-4 text-[13.5px] font-bold text-white hover:bg-emerald-700">Done</button>
        </div>
      </div>
    </div>
  );
}
