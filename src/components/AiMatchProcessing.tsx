import { useEffect, useState } from 'react';
import { Bell, Building2, Check, KanbanSquare, Mail, Target, type LucideIcon } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Link } from 'react-router-dom';
import { enableWebPush } from '../lib/onesignal';
import { supabase } from '../lib/supabase';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';
const SLIDE_MS = 4500;

type Feature = { key: string; icon: LucideIcon; bg: string; blobA: string; blobB: string; title: string; line: string };

// Each feature owns the whole screen: its colours, one big line, one small one.
const FEATURES: Feature[] = [
  { key: 'gmail', icon: Mail, bg: 'from-rose-500 via-orange-500 to-amber-400', blobA: 'bg-yellow-300', blobB: 'bg-fuchsia-500', title: 'Bulk send from Gmail', line: 'Your inbox. Resume attached.' },
  { key: 'today', icon: Target, bg: 'from-blue-600 via-indigo-600 to-violet-600', blobA: 'bg-cyan-400', blobB: 'bg-fuchsia-500', title: '100 submits a day', line: 'Send or skip. One click.' },
  { key: 'push', icon: Bell, bg: 'from-fuchsia-600 via-pink-500 to-orange-400', blobA: 'bg-yellow-300', blobB: 'bg-violet-600', title: 'Be first. Always.', line: 'Instant alerts on new matches.' },
  { key: 'career', icon: Building2, bg: 'from-emerald-500 via-teal-500 to-cyan-500', blobA: 'bg-lime-300', blobB: 'bg-blue-600', title: '40+ career sites', line: 'Apply direct. Refreshed hourly.' },
  { key: 'tracker', icon: KanbanSquare, bg: 'from-violet-700 via-purple-600 to-pink-500', blobA: 'bg-sky-400', blobB: 'bg-rose-400', title: 'Auto-tracked pipeline', line: 'Every send. Every reply.' },
];

function stepOf(phase: string | null): number {
  const p = (phase ?? '').toLowerCase();
  if (p.startsWith('scoring') || p.startsWith('saved')) return 2;
  if (p.startsWith('searching') || p.startsWith('found')) return 1;
  return 0;
}

const STEP_LABELS = ['Reading', 'Searching', 'Matching'];

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

// Full screen while AI Match runs: a progress ring over a colour field that
// changes with each feature card.
export default function AiMatchProcessing({ kind, phase, pct, gmailConnected, onConnectGmail, onHide }: {
  kind: 'jobs' | 'hotlist';
  phase: string | null;
  pct: number | null;
  gmailConnected: boolean;
  onConnectGmail: () => void;
  onHide: () => void;
}) {
  const native = Capacitor.isNativePlatform();
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  // Today is a desktop page; phones skip its card.
  const features = wide ? FEATURES : FEATURES.filter((f) => f.key !== 'today');
  const [slide, setSlide] = useState(0);
  const [pushState, setPushState] = useState<NotificationPermission | 'unsupported'>(() => (
    typeof window !== 'undefined' && 'Notification' in window && !native ? Notification.permission : 'unsupported'
  ));

  useEffect(() => {
    const id = setInterval(() => setSlide((s) => (s + 1) % features.length), SLIDE_MS);
    return () => clearInterval(id);
  }, [features.length]);

  const [weekCount, setWeekCount] = useState<number | null>(null);
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

  const step = stepOf(phase);
  // Reading and searching fill the first half; scoring (the only phase with a
  // real count) the second.
  const ring = step < 2 ? 12 + step * 23 : 50 + Math.round((pct ?? 0) / 2);
  const index = slide % features.length;
  const feature = features[index];
  const R = 70;
  const C = 2 * Math.PI * R;

  const pill = 'inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-bold shadow-xl shadow-black/20 transition-transform hover:scale-105';
  const done = (label: string) => <span className={`${pill} bg-white/20 text-white backdrop-blur`}><Check size={18} strokeWidth={3} />{label}</span>;
  const cta = (() => {
    switch (feature.key) {
      case 'gmail':
        return gmailConnected ? done('Gmail connected')
          : <button type="button" onClick={onConnectGmail} className={`${pill} bg-white text-gray-900`}><Mail size={18} />Connect Gmail</button>;
      case 'today':
        return <Link to="/today" className={`${pill} bg-white text-gray-900`}>Open Today</Link>;
      case 'push':
        if (pushState === 'granted') return done('Alerts on');
        if (pushState === 'default') return <button type="button" onClick={() => { void enableWebPush().then(setPushState); }} className={`${pill} bg-white text-gray-900`}><Bell size={18} />Turn on alerts</button>;
        return native ? null : <a href={PLAY_URL} target="_blank" rel="noreferrer" className={`${pill} bg-white text-gray-900`}>Get the app</a>;
      default:
        return null;
    }
  })();

  return (
    <div className="fixed inset-0 z-[65] overflow-hidden bg-indigo-950" role="dialog" aria-modal="true" aria-label="AI Match in progress">
      {/* Colour fields, cross-faded as the cards change. */}
      {features.map((f, i) => (
        <div key={f.key} className={`absolute inset-0 bg-gradient-to-br ${f.bg} transition-opacity duration-1000 ${i === index ? 'opacity-100' : 'opacity-0'}`}>
          <div className={`animate-blob absolute -left-24 -top-24 h-[28rem] w-[28rem] rounded-full ${f.blobA} opacity-60 mix-blend-overlay blur-3xl`} />
          <div className={`animate-blob-slow absolute -bottom-32 -right-24 h-[32rem] w-[32rem] rounded-full ${f.blobB} opacity-60 mix-blend-overlay blur-3xl`} />
        </div>
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.18)_100%)]" />

      <div className="relative flex h-full flex-col items-center justify-between px-6 py-10 text-white sm:py-14">
        {/* Progress */}
        <div className="flex flex-col items-center">
          <div className="relative h-40 w-40">
            <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
              <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="10" />
              <circle
                cx="80" cy="80" r={R} fill="none" stroke="white" strokeWidth="10" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - ring / 100)}
                className="transition-[stroke-dashoffset] duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[44px] font-black leading-none tabular-nums">{ring}<span className="text-[22px]">%</span></span>
            </div>
            <div className="animate-ping-slow absolute inset-0 rounded-full ring-2 ring-white/30" />
          </div>
          <p className="mt-4 rounded-full bg-white/15 px-4 py-1.5 text-[13px] font-semibold tracking-wide backdrop-blur">
            {STEP_LABELS[step]}{weekCount ? ` ${weekCount.toLocaleString()} ${kind === 'hotlist' ? 'consultants' : 'jobs'} · last 7 days` : ''}
          </p>
        </div>

        {/* Feature */}
        <div key={feature.key} className="animate-fade-in-up flex flex-col items-center text-center">
          <span className="animate-float flex h-24 w-24 items-center justify-center rounded-[28px] bg-white/20 shadow-2xl shadow-black/20 ring-1 ring-white/40 backdrop-blur-md">
            <feature.icon size={46} strokeWidth={2} />
          </span>
          <h2 className="mt-7 text-[40px] font-black leading-[1.05] tracking-tight drop-shadow-sm sm:text-[56px]">{feature.title}</h2>
          <p className="mt-3 text-[17px] font-medium text-white/85 sm:text-[19px]">{feature.line}</p>
          <div className="mt-7 flex h-12 items-center">{cta}</div>
        </div>

        {/* Dots + exit */}
        <div className="flex flex-col items-center gap-5">
          <div className="flex gap-2">
            {features.map((f, i) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setSlide(i)}
                aria-label={f.title}
                className={`h-2.5 rounded-full transition-all ${i === index ? 'w-8 bg-white' : 'w-2.5 bg-white/40 hover:bg-white/70'}`}
              />
            ))}
          </div>
          <button type="button" onClick={onHide} className="text-[13px] font-semibold text-white/75 hover:text-white">
            Keep browsing
          </button>
        </div>
      </div>
    </div>
  );
}
