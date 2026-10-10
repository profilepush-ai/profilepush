import { useEffect, useState } from 'react';
import { Bookmark, Briefcase, Check, ChevronLeft, Clock, Code2, Copy, DollarSign, ExternalLink, FileText, Globe, Mail, MapPin, Send, Share2, ShieldCheck } from 'lucide-react';
import LogoSpinner from '../LogoSpinner';
import { hideEmails, openLeadPostContent } from '../LeadCard';
import { supabase } from '../../lib/supabase';
import { agoLabel, hashColor } from '../../lib/match-fit';
import { fitFor, leadOrg, leadTitle, strings, subjectName, type CardItem, type Kind, type Subject } from '../../lib/today';
import { CompanyLogo, FitRing, Initials, RateBar, SkillTiles, UsMap, VisaRow } from './Visuals';

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

function CopyRow({ label, value }: { label: string; value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-center gap-2.5 border-t border-gray-100 py-2 text-[13px] first:border-0 dark:border-white/5">
      <span className="w-28 shrink-0 text-gray-400">{label}</span>
      <b className="min-w-0 flex-1 truncate font-semibold">{value}</b>
      <button type="button" aria-label={`Copy ${label}`} title="Copy"
        onClick={() => { void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}
        className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5">
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

const box = 'rounded-2xl border border-gray-200 bg-white px-3.5 py-3 dark:border-white/10 dark:bg-[#20242a]';
const boxTitle = 'mb-2 flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.07em] text-gray-400';

export default function MatchDetail({
  item, kind, subject, mode, position, accountId, gmailConnected, busy,
  onBack, onApplyEmail, onApplySite, onAskResume, onSave, onShare, onDismiss, onSubject, onConnectGmail,
}: {
  item: CardItem; kind: Kind; subject: Subject | undefined; mode: 'sheet' | 'pane'; position?: { index: number; total: number; label: string };
  accountId: string | undefined; gmailConnected: boolean | null; busy?: boolean;
  onBack?: () => void; onApplyEmail: (draft: Draft, resumeId: string | null) => void; onApplySite: () => void; onAskResume: () => void;
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState('');
  const resumes = subject?.resumes ?? [];
  const [resumeId, setResumeId] = useState<string | null>(() => (resumes.find((r) => r.is_default) ?? resumes[0])?.id ?? null);

  useEffect(() => {
    let alive = true;
    setPost(null); setPostOpen(false);
    openLeadPostContent(lead.id, lead.kind)
      .then(({ content }) => { if (alive) setPost(cleanDescription(content === 'No post content available.' ? '' : content)); })
      .catch(() => { if (alive) setPost(''); });
    return () => { alive = false; };
  }, [lead.id, lead.kind]);

  // The application email, written by AI, ready to edit.
  useEffect(() => {
    setDraft(null); setDraftError('');
    if (!email || !accountId) return;
    let alive = true;
    void supabase.functions.invoke('submit-consultant', { body: { action: 'preview', account_id: accountId, subject_id: item.subject_id, job_id: lead.id } })
      .then(async ({ data, error }) => {
        if (!alive) return;
        if (error) {
          const ctx = (error as { context?: Response }).context;
          const payload = ctx ? await ctx.json().catch(() => null) : null;
          setDraftError(payload?.message || payload?.error || 'Could not write the email.');
          return;
        }
        setDraft({ subject: data.subject, body: data.body, toName: data.to_name, duplicate: data.duplicate ?? null });
      });
    return () => { alive = false; };
  }, [email, accountId, item.subject_id, lead.id]);

  useEffect(() => { setResumeId((resumes.find((r) => r.is_default) ?? resumes[0])?.id ?? null); }, [item.subject_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const duplicate = item.duplicate || draft?.duplicate || null;
  const iconBtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-white/5';

  const hero = (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 p-3.5 dark:border-white/10"
      style={{ background: `linear-gradient(165deg, color-mix(in srgb, ${hashColor(leadOrg(lead))} 22%, var(--pp-surface)), var(--pp-surface) 72%)` }}>
      <div className="flex items-start gap-3">
        <CompanyLogo name={leadOrg(lead)} avatar={lead.avatar} domain={lead.logo_domain} size={52} round={Boolean(lead.avatar)} />
        <div className="min-w-0 flex-1">
          <h2 className="text-balance text-[19px] font-extrabold leading-tight tracking-tight">{leadTitle(lead)}</h2>
          <p className="mt-0.5 text-[13px] text-gray-600 dark:text-slate-400">{leadOrg(lead)}{lead.poster && lead.company && lead.poster !== lead.company ? ` · ${lead.poster}` : ''}</p>
        </div>
        <FitRing value={item.fit ?? Math.round(item.similarity * 100)} size={62} />
      </div>
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
  const board = (
    <section className="grid grid-cols-2 gap-2.5">
      <div className={`${box} col-span-2`}>
        <h4 className={boxTitle}><Code2 size={13} />Skills<span className="ml-auto normal-case tracking-normal text-emerald-600 dark:text-emerald-400">{okSkills} of {fit.skills.length}</span></h4>
        <SkillTiles skills={fit.skills} />
      </div>
      <div className={box}>
        <h4 className={boxTitle}>{fit.location.kind === 'remote' ? <Globe size={13} /> : <MapPin size={13} />}Location</h4>
        <UsMap jobState={fit.location.jobState} profileState={fit.location.profileState} remote={fit.location.kind === 'remote'} profileColor={color} />
        <p className="mt-2 text-[12px] font-semibold text-gray-600 dark:text-slate-300">{fit.location.label}</p>
      </div>
      <div className={box}>
        <h4 className={boxTitle}><DollarSign size={13} />Rate</h4>
        <RateBar job={fit.rate.job} mine={fit.rate.mine} mineLabel={name.split(' ')[0]} mineColor={color} />
        <p className="text-[12px] font-semibold text-gray-600 dark:text-slate-300">{fit.rate.job ? `Pays $${Math.round(fit.rate.job)}/hr${fit.rate.mine ? `, asks $${Math.round(fit.rate.mine)}` : ''}` : (lead.pay || 'Not in the post')}</p>
      </div>
      <div className={`${box} col-span-2`}>
        <h4 className={boxTitle}><ShieldCheck size={13} />Visa</h4>
        <VisaRow accepted={fit.visa.accepted} mine={fit.visa.mine} />
      </div>
    </section>
  );

  const postBox = (
    <section className={box}>
      <h4 className={boxTitle}><FileText size={13} />{kind === 'hotlist' ? 'Job post' : 'Profile post'}</h4>
      {post == null ? <div className="flex justify-center py-4"><LogoSpinner size={16} /></div> : (
        <>
          <p className={`whitespace-pre-wrap text-[13px] leading-relaxed text-gray-600 dark:text-slate-300 ${postOpen ? '' : 'line-clamp-4'}`}>{post || 'No text in this post.'}</p>
          {post && <button type="button" onClick={() => setPostOpen((o) => !o)} className="mt-1.5 text-[13px] font-bold text-blue-600 dark:text-blue-400">{postOpen ? 'Show less' : 'Show full post'}</button>}
        </>
      )}
    </section>
  );

  let action: JSX.Element;
  if (kind === 'job') {
    action = (
      <section className={`${box} bg-amber-50/60 dark:bg-amber-500/5`}>
        <h4 className={`${boxTitle} !text-amber-700 dark:!text-amber-300`}><FileText size={13} />Ask for the resume</h4>
        <p className="text-[13px] leading-relaxed text-gray-700 dark:text-slate-300">
          We write a short email to {lead.poster || 'the recruiter'} asking for this profile&apos;s resume, rate and availability. You see it before it goes.
        </p>
      </section>
    );
  } else if (site) {
    action = (
      <section className={box}>
        <h4 className={boxTitle}><ExternalLink size={13} />Apply on {leadOrg(lead)}&apos;s site</h4>
        <ol className="mb-2 space-y-1.5 text-[13.5px]">
          {[`Copy ${name}'s details below`, 'Tap Apply on their site and paste them in', 'We mark it applied for you'].map((t, i) => (
            <li key={t} className="flex items-center gap-2.5"><span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-emerald-50 text-[12px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{i + 1}</span>{t}</li>
          ))}
        </ol>
        <CopyRow label="Name" value={subject?.name} />
        <CopyRow label="Role" value={subject?.title} />
        <CopyRow label="Work authorization" value={subject?.visa} />
        <CopyRow label="Location" value={strings(subject?.locations)[0]} />
        <CopyRow label="Rate" value={subject?.rate_min ? `$${subject.rate_min}${subject.rate_max && subject.rate_max !== subject.rate_min ? `-${subject.rate_max}` : ''}/hr` : null} />
        <CopyRow label="Experience" value={subject?.years ? `${Math.round(subject.years)} years` : null} />
        <CopyRow label="Skills" value={strings(subject?.skills).join(', ')} />
        <CopyRow label="Resume" value={(resumes.find((r) => r.id === resumeId) ?? resumes[0])?.url} />
      </section>
    );
  } else if (!lead.has_email) {
    action = <section className={box}><p className="text-[13px] text-gray-500">This post has no email to apply to.</p></section>;
  } else if (gmailConnected === false) {
    action = (
      <section className={`${box} bg-amber-50/60 dark:bg-amber-500/5`}>
        <h4 className={`${boxTitle} !text-amber-700 dark:!text-amber-300`}><Mail size={13} />Apply by email</h4>
        <p className="mb-2.5 text-[13px] text-gray-700 dark:text-slate-300">Applications go from your own Gmail. Connect it once.</p>
        <button type="button" onClick={onConnectGmail} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-amber-600 px-4 text-[13px] font-bold text-white hover:bg-amber-700"><Mail size={14} />Connect Gmail</button>
      </section>
    );
  } else {
    action = (
      <section className={`${box} border-amber-200 bg-amber-50/70 dark:border-amber-400/25 dark:bg-amber-500/[0.06]`}>
        <h4 className={`${boxTitle} !text-amber-700 dark:!text-amber-300`}><Mail size={13} />Your application email</h4>
        {draftError ? <p className="text-[12.5px] text-red-600">{draftError}</p> : !draft ? (
          <div className="flex items-center gap-2 py-6 text-[12.5px] text-gray-500"><LogoSpinner size={14} />Writing the email…</div>
        ) : (
          <>
            <p className="mb-2 text-[12px] text-gray-600 dark:text-slate-400">To {draft.toName} · from your Gmail · written by AI, edit anything</p>
            {duplicate && <p className="mb-2 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[12px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">{duplicate}</p>}
            <input aria-label="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              className="h-9 w-full rounded-[9px] border border-amber-200 bg-white px-2.5 text-[13.5px] outline-none focus:border-amber-400 dark:border-amber-400/25 dark:bg-[#1E2126]" />
            <textarea aria-label="Email" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={10}
              className="mt-2 w-full resize-y rounded-[9px] border border-amber-200 bg-white p-2.5 text-[13.5px] leading-relaxed outline-none focus:border-amber-400 dark:border-amber-400/25 dark:bg-[#1E2126]" />
            {resumes.length > 0 ? (
              <label className="mt-2 flex items-center gap-2 text-[12.5px] text-gray-600 dark:text-slate-300">
                <FileText size={15} className="shrink-0" />
                <select value={resumeId ?? ''} onChange={(e) => setResumeId(e.target.value)} aria-label="Resume to attach"
                  className="min-w-0 flex-1 rounded-[9px] border border-amber-200 bg-white px-2 py-1.5 dark:border-amber-400/25 dark:bg-[#1E2126]">
                  {resumes.map((r) => <option key={r.id} value={r.id}>{r.file_name}{r.is_default && resumes.length > 1 ? ' (default)' : ''}</option>)}
                </select>
              </label>
            ) : <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">No resume on this profile yet. Add one from the profile.</p>}
          </>
        )}
      </section>
    );
  }

  const primary = kind === 'job'
    ? <button type="button" onClick={onAskResume} disabled={busy} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 text-[15px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"><FileText size={17} />Ask Resume</button>
    : site
      ? <button type="button" onClick={onApplySite} disabled={busy} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-[15px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><ExternalLink size={17} />Apply on their site</button>
      : <button type="button" onClick={() => draft && onApplyEmail(draft, resumeId)} disabled={busy || !draft || Boolean(duplicate) || gmailConnected === false} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 text-[15px] font-bold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? <LogoSpinner size={15} /> : <Send size={17} />}Apply by email</button>;
  const secondary = item.stage === 'new' && !saved && onDismiss
    ? <button type="button" onClick={onDismiss} className="h-12 shrink-0 rounded-xl border border-gray-300 px-4 text-[14px] font-bold text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">Not a match</button>
    : <button type="button" onClick={onSave} className="h-12 shrink-0 rounded-xl border border-gray-300 px-4 text-[14px] font-bold text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">{saved ? 'Unsave' : 'Save'}</button>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mode === 'sheet' && (
        <div className="flex h-14 shrink-0 items-center gap-0.5 border-b border-gray-200 bg-white px-1.5 dark:border-white/10 dark:bg-[#20242a]">
          <button type="button" onClick={onBack} className={iconBtn} aria-label="Back"><ChevronLeft size={22} /></button>
          <span className="flex-1 text-[13px] font-semibold tabular-nums text-gray-400">{position ? `${position.label} ${position.index + 1} of ${position.total}` : ''}</span>
          <button type="button" className={iconBtn} onClick={onShare} aria-label="Share"><Share2 size={19} /></button>
          <button type="button" className={`${iconBtn} ${saved ? '!text-blue-600' : ''}`} onClick={onSave} aria-label="Save for later" aria-pressed={saved}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} /></button>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto bg-[#f3f2ee] p-4 dark:bg-[#1B1D21]">
        {hero}
        {mode === 'pane' ? (
          <div className="grid grid-cols-2 items-start gap-3.5">
            <div className="min-w-0 space-y-3.5">{board}{postBox}</div>
            <div className="min-w-0 space-y-3.5">{action}</div>
          </div>
        ) : (<>{board}{action}{postBox}</>)}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-gray-200 bg-white px-3.5 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] dark:border-white/10 dark:bg-[#20242a]">
        {secondary}{primary}
      </div>
    </div>
  );
}
