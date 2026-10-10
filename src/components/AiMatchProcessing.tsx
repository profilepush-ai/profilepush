import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Check, Mail, Send, Smartphone, type LucideIcon } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { enableWebPush } from '../lib/onesignal';
import { supabase } from '../lib/supabase';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';

// A match usually takes 30-50s. The bar and the countdown are paced on this
// until scoring reports real progress.
const EXPECTED_SECONDS = 40;

function stepOf(phase: string | null): number {
  const p = (phase ?? '').toLowerCase();
  if (p.startsWith('scoring') || p.startsWith('saved')) return 2;
  if (p.startsWith('searching') || p.startsWith('found')) return 1;
  return 0;
}

// The last 7 days of posts, from the Feed's cached counts (one cheap call).
async function loadWeekCount(kind: 'jobs' | 'hotlist'): Promise<number | null> {
  const since = new Date(Date.now() - 168 * 3600 * 1000).toISOString();
  const { data, error } = await supabase.rpc(
    (kind === 'hotlist' ? 'get_social_hotlist_feed_facets' : 'get_pulse_social_feed_facets') as never,
    { p_since: since } as never,
  );
  if (error || !Array.isArray(data)) return null;
  const total = (data as Array<{ facet_category: string; facet_count: number }>).find((r) => r.facet_category === 'total');
  return total ? Number(total.facet_count) : null;
}

function ChecklistItem({ icon, done, title, detail, action, delay }: {
  icon: LucideIcon; done: boolean; title: string; detail: string; action?: ReactNode; delay: number;
}) {
  const Icon = icon;
  return (
    <li
      className="flex items-center gap-3.5 rounded-xl border border-gray-200 bg-white px-4 py-3.5 motion-safe:animate-fade-in-up dark:border-white/10 dark:bg-[#20242a]"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-300'}`}>
        {done ? <Check size={18} strokeWidth={2.75} /> : <Icon size={17} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-gray-500 dark:text-slate-400">{detail}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

// Full screen while AI Match runs: the progress of this match, then three
// things that make the results go further, each showing whether it is done.
export default function AiMatchProcessing({ kind, subject, phase, pct, gmailConnected, onConnectGmail }: {
  kind: 'jobs' | 'hotlist';
  /** What they asked to match, shown back so the wait is about their search. */
  subject?: string;
  phase: string | null;
  pct: number | null;
  gmailConnected: boolean;
  onConnectGmail: () => void;
}) {
  const native = Capacitor.isNativePlatform();
  const [pushState, setPushState] = useState<NotificationPermission | 'unsupported'>(() => (
    typeof window !== 'undefined' && 'Notification' in window && !native ? Notification.permission : 'unsupported'
  ));
  const [weekCount, setWeekCount] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const scoringFrom = useRef<{ at: number; pct: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [shown, setShown] = useState(4);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let live = true;
    void loadWeekCount(kind).then((n) => { if (live) setWeekCount(n); });
    return () => { live = false; };
  }, [kind]);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);

  // Progress: paced by time until scoring reports real numbers, never backwards.
  const step = stepOf(phase);
  const elapsed = (now - startedAt.current) / 1000;
  if (step === 2 && pct != null && !scoringFrom.current) scoringFrom.current = { at: now, pct };
  const paced = 92 * (1 - Math.exp(-elapsed / 18));
  const real = step < 2 ? 8 + step * 20 : 50 + (pct ?? 0) * 0.48;
  const target = Math.min(99, Math.max(paced, real));
  useEffect(() => {
    setShown((cur) => (target > cur ? target : cur));
  }, [target]);
  const percent = Math.round(shown);
  let left = EXPECTED_SECONDS - elapsed;
  const s0 = scoringFrom.current;
  if (s0 && pct != null && pct > s0.pct + 3) left = (100 - pct) / ((pct - s0.pct) / ((now - s0.at) / 1000));
  const leftLabel = left > 4 ? `About ${Math.ceil(left / 5) * 5}s left` : 'Almost done';
  const noun = kind === 'hotlist' ? 'consultants' : 'jobs';
  const status = step === 0 ? 'Reading what you pasted'
    : weekCount ? `Searching ${weekCount.toLocaleString()} ${noun} from the last 7 days` : `Searching the last 7 days of ${noun}`;
  const heading = kind === 'hotlist' ? 'Finding consultants for your requirement' : 'Finding jobs for your consultant';

  const button = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10';
  const alertsOn = native ? pushState === 'granted' : false;
  const appAction = native
    ? (pushState === 'granted' ? undefined : <button type="button" onClick={() => { void enableWebPush().then(setPushState); }} className={button}><Bell size={14} />Turn on</button>)
    : <a href={PLAY_URL} target="_blank" rel="noreferrer" className={button}><Smartphone size={14} />Get the app</a>;
  const ready = Number(gmailConnected) * 2 + Number(alertsOn);

  return (
    <div className="fixed inset-0 z-[65] overflow-y-auto bg-[#f3f2ee] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100" role="dialog" aria-modal="true" aria-label="AI Match in progress">
      <div className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center px-4 py-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#20242a]">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">AI Match</p>
          <p className="mt-1 text-[18px] font-bold leading-snug">{heading}</p>
          {subject && <p className="mt-1 truncate text-[13px] text-gray-500 dark:text-slate-400">“{subject}”</p>}
          <div className="mt-4 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[13px] text-gray-600 dark:text-slate-300">{status}</span>
            <span className="shrink-0 text-[15px] font-bold tabular-nums">{percent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
            <div className="h-full rounded-full bg-blue-600 transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-[12px] tabular-nums text-gray-400">{leftLabel}</p>
        </div>

        <div className="mt-7 flex items-baseline justify-between px-1">
          <p className="text-[15px] font-bold">Get ready while we match</p>
          <p className="text-[12.5px] tabular-nums text-gray-500 dark:text-slate-400">{ready} of 3 ready</p>
        </div>
        <ul className="mt-3 space-y-2">
          <ChecklistItem
            icon={Mail}
            done={gmailConnected}
            title={gmailConnected ? 'Gmail connected' : 'Connect Gmail'}
            detail="Submissions go from your own inbox, and replies come back to it."
            action={gmailConnected ? undefined : <button type="button" onClick={onConnectGmail} className={button}><Mail size={14} />Connect</button>}
            delay={0}
          />
          <ChecklistItem
            icon={Send}
            done={gmailConnected}
            title={gmailConnected ? 'Bulk send is ready' : 'Bulk send'}
            detail={gmailConnected
              ? 'When your matches load, tick the ones you want and press Send Now.'
              : 'Send to all your matches in one click. Needs Gmail connected.'}
            delay={120}
          />
          <ChecklistItem
            icon={Smartphone}
            done={alertsOn}
            title={alertsOn ? 'Alerts are on' : 'Get the mobile app'}
            detail="New matches reach your phone the moment they land."
            action={appAction}
            delay={240}
          />
        </ul>
      </div>
    </div>
  );
}
