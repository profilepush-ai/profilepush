import { useEffect, useState } from 'react';
import { Check, Copy, Linkedin, MessageCircle, Share2 } from 'lucide-react';
import { loadMyReferral, referralLink, type MyReferral } from '../lib/referral';
import { trackEvent } from '../lib/track';

// Settings > Refer and earn: their link, ways to share it, and what it earned.
export default function ReferPanel() {
  const [me, setMe] = useState<MyReferral | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { loadMyReferral().then(setMe).catch(() => setMe(null)); }, []);
  if (!me) return <p className="text-[13px] text-gray-500">Loading your link…</p>;
  const link = referralLink(me.code);
  const text = `I use ProfilePush to match my profiles to fresh jobs every day. Join with my link and get 150 free credits: ${link}`;
  const copy = () => { void navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); trackEvent('referral_copied'); }); };
  const nativeShare = () => { void navigator.share?.({ title: 'ProfilePush', text, url: link }).then(() => trackEvent('referral_shared', { via: 'native' })).catch(() => {}); };
  const button = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5';
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input readOnly value={link} aria-label="Your referral link" onFocus={(e) => e.target.select()}
          className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 text-[13.5px] font-semibold text-gray-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-100" />
        <button type="button" onClick={copy} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-[13.5px] font-bold text-white hover:bg-blue-700">
          {copied ? <Check size={15} strokeWidth={3} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className={button} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => trackEvent('referral_shared', { via: 'whatsapp' })}><MessageCircle size={15} />WhatsApp</a>
        <a className={button} href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`} target="_blank" rel="noreferrer" onClick={() => trackEvent('referral_shared', { via: 'linkedin' })}><Linkedin size={15} />LinkedIn</a>
        {'share' in navigator && <button type="button" className={button} onClick={nativeShare}><Share2 size={15} />More</button>}
      </div>
      <p className="text-[12.5px] tabular-nums text-gray-500 dark:text-slate-400">
        {me.joined ? <><b className="text-gray-900 dark:text-white">{me.joined}</b> joined with your link · <b className="text-emerald-600">+{me.earned}</b> credits earned</> : 'Nobody has joined with your link yet.'}
      </p>
    </div>
  );
}
