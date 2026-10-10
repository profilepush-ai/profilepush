import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Check, Mail, Send, Smartphone, type LucideIcon } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { enableWebPush } from '../lib/onesignal';
import { supabase } from '../lib/supabase';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';

// A match usually takes 30-50s. The bar and the countdown are paced on this
// until scoring reports real progress.
const EXPECTED_SECONDS = 40;
// Each item stays up this long; three fit inside one wait.
const SLIDE_MS = 6000;

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
  const slideFrom = useRef(Date.now());
  const [slideBase, setSlideBase] = useState(0);

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
  const leftLabel = left > 4 ? `~${Math.ceil(left / 5) * 5}s left` : 'almost done';
  const noun = kind === 'hotlist' ? 'consultants' : 'jobs';
  const status = step === 0 ? 'Reading your post'
    : weekCount ? `${weekCount.toLocaleString()} ${noun} · last 7 days` : `${noun[0].toUpperCase()}${noun.slice(1)} · last 7 days`;
  const heading = kind === 'hotlist' ? 'Finding consultants for your requirement' : 'Finding jobs for your consultant';

  const primary = 'inline-flex h-11 items-center gap-2 rounded-full bg-blue-600 px-6 text-[14px] font-semibold text-white shadow-sm hover:bg-blue-700';
  const okBadge = (label: string) => (
    <span className="inline-flex h-11 items-center gap-2 rounded-full bg-emerald-50 px-5 text-[14px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
      <Check size={17} strokeWidth={3} />{label}
    </span>
  );
  const alertsOn = native && pushState === 'granted';
  const slides: Array<{ key: string; icon: LucideIcon; title: string; line: string; action: ReactNode }> = [
    {
      key: 'gmail', icon: Mail, title: 'Connect Gmail', line: 'Send from your own inbox.',
      action: gmailConnected ? okBadge('Connected') : <button type="button" onClick={onConnectGmail} className={primary}><Mail size={16} />Connect Gmail</button>,
    },
    {
      key: 'bulk', icon: Send, title: 'Bulk send', line: 'All your matches, one click.',
      action: gmailConnected ? okBadge('Ready') : <button type="button" onClick={onConnectGmail} className={primary}><Mail size={16} />Connect Gmail first</button>,
    },
    {
      key: 'app', icon: Smartphone, title: 'Get the app', line: 'New matches on your phone.',
      action: !native
        ? <a href={PLAY_URL} target="_blank" rel="noreferrer" className={primary}><Smartphone size={16} />Get the app</a>
        : alertsOn ? okBadge('Alerts on')
        : <button type="button" onClick={() => { void enableWebPush().then(setPushState); }} className={primary}><Bell size={16} />Turn on alerts</button>,
    },
  ];
  const index = Math.floor((now - slideFrom.current) / SLIDE_MS) % slides.length;
  const slide = slides[(index + slideBase) % slides.length];
  const goTo = (i: number) => { slideFrom.current = Date.now(); setSlideBase(i); setNow(Date.now()); };

  return (
    <div className="fixed inset-0 z-[65] overflow-y-auto bg-[#f3f2ee] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100" role="dialog" aria-modal="true" aria-label="AI Match in progress">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
        {/* This match: one line of what, one bar, the numbers. */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#20242a]">
          <p className="text-[17px] font-bold">{heading}</p>
          {subject && <p className="mt-0.5 truncate text-[13px] text-gray-500 dark:text-slate-400">{subject}</p>}
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
            <div className="h-full rounded-full bg-blue-600 transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[12.5px] tabular-nums text-gray-500 dark:text-slate-400">
            <span>{status}</span>
            <span><b className="text-gray-900 dark:text-white">{percent}%</b> · {leftLabel}</span>
          </div>
        </div>

        {/* One thing at a time. */}
        <div className="rounded-2xl border border-gray-200 bg-white px-6 pb-6 pt-8 text-center shadow-sm dark:border-white/10 dark:bg-[#20242a]">
          <div key={slide.key} className="flex flex-col items-center motion-safe:animate-fade-in-up">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
              <slide.icon size={30} strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-[20px] font-bold">{slide.title}</p>
            <p className="mt-1 text-[14.5px] text-gray-500 dark:text-slate-400">{slide.line}</p>
            <div className="mt-5">{slide.action}</div>
          </div>
          <div className="mt-6 flex justify-center gap-2">
            {slides.map((sl, i) => (
              <button
                key={sl.key}
                type="button"
                onClick={() => goTo(i)}
                aria-label={sl.title}
                className={`h-2 rounded-full transition-all ${sl.key === slide.key ? 'w-6 bg-blue-600' : 'w-2 bg-gray-300 hover:bg-gray-400 dark:bg-white/20'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
