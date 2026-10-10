import { useEffect, useState } from 'react';
import { Bookmark, Briefcase, Check, ChevronLeft, ChevronRight, Clock, Code2, DollarSign, ExternalLink, FileText, Globe, Mail, MapPin, Send, Share2, ShieldCheck } from 'lucide-react';
import LogoSpinner from '../LogoSpinner';
import { hideEmails, openLeadPostContent } from '../LeadCard';
import { agoLabel, hashColor } from '../../lib/match-fit';
import { fitFor, leadOrg, leadTitle, missingFor, subjectName, type CardItem, type Kind, type Question, type Subject } from '../../lib/today';
import { CompanyLogo, EngagementRow, FitLine, Initials, RateBar, SkillTiles, UsMap, VisaRow } from './Visuals';
import SendResumeSheet from './SendResumeSheet';

export type Draft = { subject: string; body: string; toName: string; duplicate: string | null };

// The post as a recruiter reads it: addresses hidden, trailing #hashtags gone.
function cleanDescription(raw: string) {
  let text = hideEmails(raw).split('[email hidden · use AI Submit]').join('[email hidden]');
  for (let prev = ''; prev !== text;) {
    prev = text;
    text = text.replace(/(^|[\s(;,])#[\p{L}\p{N}_][\p{L}\p{N}_&.-]*;?/gu, '$1');
  }
  return text.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
    .filter((l, i, all) => l.trim() !== '' || (i > 0 && all[i - 1].trim() !== '')).join('\n').trim();
}

const box = 'rounded-2xl border border-gray-200 bg-white px-3.5 py-3 dark:border-white/10 dark:bg-[#20242a]';
const boxTitle = 'mb-2 flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.07em] text-gray-400';
// Columns for the facts row, by how many facts are shown.
const PANE_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };
const WIDE_COLS: Record<number, string> = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' };

export default function MatchDetail({
  item, kind, subject, mode, position, accountId, gmailConnected, busy,
  onBack, onPrev, onNext, onApplyEmail, onApplySite, onAskResume, onSave, onShare, onDismiss, onSubject, onConnectGmail, asked, onAsk,
}: {
  item: CardItem; kind: Kind; subject: Subject | undefined; mode: 'sheet' | 'pane'; position?: { index: number; total: number; label: string };
  accountId: string | undefined; gmailConnected: boolean | null; busy?: boolean;
  asked?: Question[]; onAsk?: (q: Question) => void;
  onBack?: () => void; onPrev?: () => void; onNext?: () => void; onApplyEmail: (draft: Draft, resumeId: string | null) => void; onApplySite: () => void; onAskResume: () => void;
  onSave: () => void; onShare: () => void; onDismiss?: () => void; onSubject: () => void; onConnectGmail: () => void;
}) {
  const lead = item.lead!;
  const fit = fitFor(kind, subject, lead);
  const saved = Boolean(item.saved_at);
  const site = kind === 'hotlist' && lead.source === 'career_site';
  const email = kind === 'hotlist' && !site && lead.has_email;
  const name = subjectName(kind, subject);
  const color = hashColor(item.subject_id);
  const [post, setPost] = useState<string | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    setPost(null); setPostOpen(false);
    openLeadPostContent(lead.id, lead.kind)
      .then(({ content }) => { if (alive) setPost(cleanDescription(content === 'No post content available.' ? '' : content)); })
      .catch(() => { if (alive) setPost(''); });
    return () => { alive = false; };
  }, [lead.id, lead.kind]);

  useEffect(() => { setSending(false); }, [item.subject_id, lead.id]);

  const iconBtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-white/5';

  // Values offered as an Ask in the bottom bar aren't also shown empty here.
  const asking = onAsk && lead.has_email ? missingFor(kind, fit) : [];
  const hero = (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 p-3.5 dark:border-white/10"
      style={{ background: `linear-gradient(165deg, color-mix(in srgb, ${hashColor(leadOrg(lead))} 22%, var(--pp-surface)), var(--pp-surface) 72%)` }}>
      <div className="flex items-start gap-3">
        <CompanyLogo name={leadOrg(lead)} avatar={lead.avatar} domain={lead.logo_domain} size={52} round={Boolean(lead.avatar)} />
        <div className="min-w-0 flex-1">
          <h2 className="text-balance text-[19px] font-extrabold leading-tight tracking-tight">{leadTitle(lead)}</h2>
          <p className="mt-0.5 text-[13px] text-gray-600 dark:text-slate-400">{leadOrg(lead)}{lead.poster && lead.company && lead.poster !== lead.company ? ` · ${lead.poster}` : ''}</p>
        </div>
      </div>
      <FitLine value={item.fit ?? Math.round(item.similarity * 100)} />
      {item.eng && <EngagementRow eng={item.eng} />}
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-gray-600 dark:text-slate-300">
        <button type="button" onClick={onSubject} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 font-bold text-gray-900 hover:border-blue-300 dark:border-white/10 dark:bg-[#20242a] dark:text-white">
          <Initials name={name} id={item.subject_id} size={18} />for {name}
        </button>
        {lead.type && <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 dark:border-white/10 dark:bg-[#20242a]"><Briefcase size={13} />{lead.type}</span>}
        {kind === 'hotlist' && <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 dark:border-white/10 dark:bg-[#20242a]">{site ? <ExternalLink size={13} /> : <Mail size={13} />}{site ? 'Apply on site' : 'Apply by email'}</span>}
        <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 dark:border-white/10 dark:bg-[#20242a]"><Clock size={13} />{agoLabel(lead.posted_at)} ago</span>
        {mode === 'pane' && (
          <span className="ml-auto flex">
            <button type="button" className={iconBtn} onClick={onShare} title="Share" aria-label="Share"><Share2 size={18} /></button>
            <button type="button" className={`${iconBtn} ${saved ? '!text-blue-600' : ''}`} onClick={onSave} title={saved ? 'Saved' : 'Save for later'} aria-label="Save for later" aria-pressed={saved}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /></button>
          </span>
        )}
      </div>
    </div>
  );

  const okSkills = fit.skills.filter((s) => s.ok).length;
  const missing = missingFor(kind, fit);
  // Skills, visa, rate and location side by side (two by two on phones).
  const cols = [
    <div key="skills" className={box}>
      <h4 className={boxTitle}><Code2 size={13} />Skills<span className="ml-auto normal-case tracking-normal text-emerald-600 dark:text-emerald-400">{okSkills} of {fit.skills.length}</span></h4>
      <SkillTiles skills={fit.skills} />
    </div>,
    !asking.includes('visa') && (
      <div key="visa" className={box}>
        <h4 className={boxTitle}><ShieldCheck size={13} />Visa</h4>
        <VisaRow accepted={fit.visa.accepted} mine={fit.visa.mine} />
      </div>
    ),
    !asking.includes('rate') && (
      <div key="rate" className={box}>
        <h4 className={boxTitle}><DollarSign size={13} />Rate</h4>
        <RateBar job={fit.rate.job} mine={fit.rate.mine} mineLabel={name.split(' ')[0]} mineColor={color} />
        <p className="text-[12px] font-semibold text-gray-600 dark:text-slate-300">{fit.rate.job ? `Pays $${Math.round(fit.rate.job)}/hr${fit.rate.mine ? `, asks $${Math.round(fit.rate.mine)}` : ''}` : (lead.pay || 'Not in the post')}</p>
      </div>
    ),
    !asking.includes('location') && (
      <div key="location" className={box}>
        <h4 className={boxTitle}>{fit.location.kind === 'remote' ? <Globe size={13} /> : <MapPin size={13} />}Location</h4>
        <div className="max-w-[200px]"><UsMap jobState={fit.location.jobState} profileState={fit.location.profileState} remote={fit.location.kind === 'remote'} profileColor={color} /></div>
        <p className="mt-2 text-[12px] font-semibold text-gray-600 dark:text-slate-300">{fit.location.label}</p>
      </div>
    ),
  ].filter(Boolean) as JSX.Element[];
  // An odd count on phones: skills takes the whole first line.
  const odd = cols.length % 2 === 1;
  const facts = (
    <section className={`grid gap-2.5 ${mode === 'pane' ? PANE_COLS[cols.length] : `grid-cols-2 ${WIDE_COLS[cols.length]}`}`}>
      {cols.map((c, i) => (i === 0 && odd && mode !== 'pane' ? <div key="skills" className="col-span-2 grid sm:col-span-1">{c}</div> : c))}
    </section>
  );

  // Desktop pane, beside the swipe card that already shows the title, score
  // and fit: who posted it, then the post itself, open.
  const postedBy = (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3.5 dark:border-white/10 dark:bg-[#20242a]">
      {lead.avatar ? <img src={lead.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
        : <CompanyLogo name={leadOrg(lead)} avatar={null} domain={lead.logo_domain} size={44} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-gray-500 dark:text-slate-400">Posted by</p>
        <b className="block truncate text-[15.5px] font-extrabold">{lead.poster || leadOrg(lead)}</b>
        <p className="truncate text-[12.5px] text-gray-500 dark:text-slate-400">{[lead.poster && lead.company && lead.poster !== lead.company ? lead.company : null, `${agoLabel(lead.posted_at)} ago`, site ? 'Apply on their site' : lead.has_email ? 'Apply by email' : null].filter(Boolean).join(' · ')}</p>
      </div>
      {(lead.post_url || lead.apply_url) && (
        <a href={lead.apply_url || lead.post_url || '#'} target="_blank" rel="noreferrer" className={iconBtn} title="Open the original post" aria-label="Open the original post"><ExternalLink size={17} /></a>
      )}
      <button type="button" className={iconBtn} onClick={onShare} title="Share" aria-label="Share"><Share2 size={18} /></button>
      <button type="button" className={`${iconBtn} ${saved ? '!text-blue-600' : ''}`} onClick={onSave} title={saved ? 'Saved' : 'Save for later'} aria-label="Save for later" aria-pressed={saved}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /></button>
    </div>
  );
  const postText = (
    <section className="rounded-2xl border border-gray-200 bg-white px-5 py-4 dark:border-white/10 dark:bg-[#20242a]">
      {post == null ? <div className="flex justify-center py-6"><LogoSpinner size={18} /></div>
        : !post ? <p className="text-[13.5px] text-gray-500">No text in this post.</p>
          : <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800 dark:text-slate-200">{post}</p>}
    </section>
  );

  const postBox = (
    <section className={box}>
      <h4 className={boxTitle}><FileText size={13} />{kind === 'hotlist' ? 'Job post' : 'Profile post'}</h4>
      {post == null ? <div className="flex justify-center py-4"><LogoSpinner size={16} /></div> : (
        !post ? <p className="text-[13px] text-gray-500">No text in this post.</p> : postOpen ? (
          <>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700 dark:text-slate-300">{post}</p>
            <button type="button" onClick={() => setPostOpen(false)} className="mt-1.5 text-[13px] font-bold text-blue-600 dark:text-blue-400">Show less</button>
          </>
        ) : (
          // Blurred until they choose to read it.
          <button type="button" onClick={() => setPostOpen(true)} className="relative block w-full text-left" aria-label="Read the job post">
            <p aria-hidden="true" className="line-clamp-4 select-none whitespace-pre-wrap text-[13px] leading-relaxed text-gray-600 blur-[4px] dark:text-slate-300">{post}</p>
            <span className="absolute inset-0 grid place-items-center">
              <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-gray-900 shadow-md ring-1 ring-black/5"><FileText size={14} />Read the {kind === 'hotlist' ? 'job' : 'profile'} post</span>
            </span>
          </button>
        )
      )}
    </section>
  );

  const primary = kind === 'job'
    ? <button type="button" onClick={onAskResume} disabled={busy} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 text-[15px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"><FileText size={17} />Ask Resume</button>
    : site
      ? <button type="button" onClick={onApplySite} disabled={busy} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-[15px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><ExternalLink size={17} />Apply on their site</button>
      // Opens the resume pick and the AI-written email.
      : <button type="button" onClick={() => setSending(true)} disabled={busy || !email} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 text-[15px] font-bold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? <LogoSpinner size={15} /> : <Send size={17} />}{email ? 'Send resume' : 'No email in the post'}</button>;
  const secondary = item.stage === 'new' && !saved && onDismiss
    ? <button type="button" onClick={onDismiss} className="h-12 shrink-0 rounded-xl border border-gray-300 px-4 text-[14px] font-bold text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">Not a match</button>
    : <button type="button" onClick={onSave} className="h-12 shrink-0 rounded-xl border border-gray-300 px-4 text-[14px] font-bold text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">{saved ? 'Unsave' : 'Save'}</button>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mode === 'sheet' && (
        <div className="flex h-14 shrink-0 items-center gap-0.5 border-b border-gray-200 bg-white px-1.5 dark:border-white/10 dark:bg-[#20242a]">
          <button type="button" onClick={onBack} className={iconBtn} aria-label="Back"><ChevronLeft size={22} /></button>
          <span className="flex flex-1 items-center justify-center gap-0.5 text-[13px] font-semibold tabular-nums text-gray-400">
            {onPrev && <button type="button" onClick={onPrev} disabled={!position || position.index <= 0} aria-label="Previous match" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/5"><ChevronLeft size={18} /></button>}
            <span>{position ? `${position.label} ${position.index + 1} of ${position.total}` : ''}</span>
            {onNext && <button type="button" onClick={onNext} disabled={!position || position.index >= position.total - 1} aria-label="Next match" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/5"><ChevronRight size={18} /></button>}
          </span>
          <button type="button" className={iconBtn} onClick={onShare} aria-label="Share"><Share2 size={19} /></button>
          <button type="button" className={`${iconBtn} ${saved ? '!text-blue-600' : ''}`} onClick={onSave} aria-label="Save for later" aria-pressed={saved}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} /></button>
        </div>
      )}
      <div className="min-h-0 flex-1 touch-pan-y space-y-3.5 overflow-y-auto bg-[#f3f2ee] p-4 dark:bg-[#1B1D21]">
        {mode === 'pane' ? <>{postedBy}{postText}</> : <>
        {hero}
        {facts}
        {/* The post, full width, blurred until opened. */}
        {postBox}
        </>}
      </div>
      <div className="shrink-0 space-y-2 border-t border-gray-200 bg-white px-3.5 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] dark:border-white/10 dark:bg-[#20242a]">
        <div className="flex gap-2">{secondary}{primary}</div>
        {/* What the post leaves out, asked of its poster (they get an email). */}
        {onAsk && lead.has_email && missing.length > 0 && (
          <div className="flex gap-2" role="group" aria-label="Ask the poster">
            {missing.map((q) => {
              const done = (asked ?? []).includes(q);
              const Icon = q === 'rate' ? DollarSign : q === 'visa' ? ShieldCheck : MapPin;
              const label = q === 'rate' ? 'Rate' : q === 'visa' ? 'Visa' : 'Location';
              return (
                <button key={q} type="button" onClick={() => !done && onAsk(q)} disabled={done} title={done ? `Asked the poster for the ${q}` : `Ask the poster for the ${q}`}
                  className={`inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border text-[14px] font-bold ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5'}`}>
                  {done ? <Check size={16} strokeWidth={3} /> : <Icon size={16} />}{label}{done ? ' asked' : '?'}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {sending && (
        <SendResumeSheet item={item} subject={subject} name={name} accountId={accountId} gmailConnected={gmailConnected}
          onConnectGmail={onConnectGmail} onClose={() => setSending(false)} onSend={(draft, resumeId) => onApplyEmail(draft, resumeId)} />
      )}
    </div>
  );
}
