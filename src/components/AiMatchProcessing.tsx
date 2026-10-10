import { useEffect, useState } from 'react';
import { Bell, Check, Mail } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { enableWebPush } from '../lib/onesignal';
import { supabase } from '../lib/supabase';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';
const TICK_MS = 700;
const TICKS_PER_SLIDE = 9;

const STEP_LABELS = ['Reading your profile', 'Searching', 'Matching'];

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

// ---- Real screens from the app, animated: the whole page, then a zoom to
// the action and a tap on it. Shots live in public/ai-match (test account,
// recruiters' names replaced). `t` counts ticks since the slide began.

type Shot = {
  src: string;
  url: string;
  /** Zoom target and scale, in % of the image. */
  zoom: { x: number; y: number; scale: number };
  /** Where the tap lands, in % of the image; omitted for no tap. */
  tap?: { x: number; y: number };
  done?: string;
};

function ScreenShot({ shot, t }: { shot: Shot; t: number }) {
  const zoomed = t >= 2;
  const tapping = shot.tap && t >= 5;
  const finished = shot.done && t >= 6;
  return (
    <div className="w-[min(92vw,760px)] overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/40 ring-1 ring-black/10">
      <div className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-2 truncate rounded-md bg-white px-2 py-0.5 text-[11px] text-gray-400 ring-1 ring-gray-200">{shot.url}</span>
      </div>
      <div className="relative aspect-[16/10] overflow-hidden">
        <div
          className="absolute inset-0 transition-transform duration-[1600ms] ease-in-out"
          style={{ transformOrigin: `${shot.zoom.x}% ${shot.zoom.y}%`, transform: `scale(${zoomed ? shot.zoom.scale : 1})` }}
        >
          <img src={shot.src} alt="" className="h-full w-full object-cover object-top" draggable={false} />
          {tapping && shot.tap && (
            <span className="pointer-events-none absolute" style={{ left: `${shot.tap.x}%`, top: `${shot.tap.y}%` }}>
              <span className="absolute -left-5 -top-5 h-10 w-10 animate-ping rounded-full bg-blue-500/50" />
              <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full border-2 border-white bg-blue-600/80 shadow-lg" />
            </span>
          )}
        </div>
        {finished && (
          <div className="animate-fade-in-up absolute top-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white shadow-xl">
            <Check size={15} strokeWidth={3} />{shot.done}
          </div>
        )}
      </div>
    </div>
  );
}

const SHOTS = ['/ai-match/today-email.jpg', '/ai-match/today-apply.jpg', '/ai-match/tracker.jpg'];

type Feature = { key: string; bg: string; blobA: string; blobB: string; title: string; shot: Shot };

const FEATURES: Feature[] = [
  {
    key: 'gmail', bg: 'from-blue-600 via-indigo-600 to-violet-600', blobA: 'bg-cyan-400', blobB: 'bg-fuchsia-500',
    title: 'AI Submit from your Gmail',
    shot: { src: SHOTS[0], url: 'profilepush.ai/today', zoom: { x: 100, y: 100, scale: 1.6 }, tap: { x: 86.8, y: 95.4 }, done: 'Submitted from your Gmail' },
  },
  {
    key: 'career', bg: 'from-emerald-500 via-teal-500 to-cyan-500', blobA: 'bg-lime-300', blobB: 'bg-blue-600',
    title: 'Apply on 40+ career sites',
    shot: { src: SHOTS[1], url: 'profilepush.ai/today', zoom: { x: 100, y: 100, scale: 1.6 }, tap: { x: 86.8, y: 95.4 }, done: 'Applied · tracked for you' },
  },
  {
    key: 'tracker', bg: 'from-violet-700 via-purple-600 to-pink-500', blobA: 'bg-sky-400', blobB: 'bg-rose-400',
    title: 'Every submission tracked',
    shot: { src: SHOTS[2], url: 'profilepush.ai/tracker', zoom: { x: 62, y: 35, scale: 1.45 } },
  },
];

// Full screen while AI Match runs: a progress ring over a colour field, and
// the app itself, animated, one feature at a time.
export default function AiMatchProcessing({ kind, phase, pct, gmailConnected, onConnectGmail }: {
  kind: 'jobs' | 'hotlist';
  phase: string | null;
  pct: number | null;
  gmailConnected: boolean;
  onConnectGmail: () => void;
}) {
  const native = Capacitor.isNativePlatform();
  const [tick, setTick] = useState(0);
  const [pushState, setPushState] = useState<NotificationPermission | 'unsupported'>(() => (
    typeof window !== 'undefined' && 'Notification' in window && !native ? Notification.permission : 'unsupported'
  ));
  const [weekCount, setWeekCount] = useState<number | null>(null);

  useEffect(() => {
    for (const src of SHOTS) { const img = new Image(); img.src = src; }
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
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

  const index = Math.floor(tick / TICKS_PER_SLIDE) % FEATURES.length;
  const t = tick % TICKS_PER_SLIDE;
  const feature = FEATURES[index];
  const step = stepOf(phase);
  // Reading and searching fill the first half; scoring the second.
  const ring = step < 2 ? 12 + step * 23 : 50 + Math.round((pct ?? 0) / 2);
  const R = 70;
  const C = 2 * Math.PI * R;

  const pill = 'inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-bold shadow-xl shadow-black/20 transition-transform hover:scale-105';
  const done = (label: string) => <span className={`${pill} bg-white/20 text-white backdrop-blur`}><Check size={17} strokeWidth={3} />{label}</span>;
  const cta = (() => {
    if (feature.key === 'gmail') {
      return gmailConnected ? done('Gmail connected')
        : <button type="button" onClick={onConnectGmail} className={`${pill} bg-white text-gray-900`}><Mail size={17} />Connect Gmail</button>;
    }
    if (feature.key === 'tracker') {
      if (pushState === 'granted') return done('Alerts on');
      if (pushState === 'default') return <button type="button" onClick={() => { void enableWebPush().then(setPushState); }} className={`${pill} bg-white text-gray-900`}><Bell size={17} />Turn on alerts</button>;
      return native ? null : <a href={PLAY_URL} target="_blank" rel="noreferrer" className={`${pill} bg-white text-gray-900`}>Get the app</a>;
    }
    return null;
  })();

  return (
    <div className="fixed inset-0 z-[65] overflow-hidden bg-indigo-950" role="dialog" aria-modal="true" aria-label="AI Match in progress">
      {FEATURES.map((f, i) => (
        <div key={f.key} className={`absolute inset-0 bg-gradient-to-br ${f.bg} transition-opacity duration-1000 ${i === index ? 'opacity-100' : 'opacity-0'}`}>
          <div className={`animate-blob absolute -left-24 -top-24 h-[28rem] w-[28rem] rounded-full ${f.blobA} opacity-60 mix-blend-overlay blur-3xl`} />
          <div className={`animate-blob-slow absolute -bottom-32 -right-24 h-[32rem] w-[32rem] rounded-full ${f.blobB} opacity-60 mix-blend-overlay blur-3xl`} />
        </div>
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.18)_100%)]" />

      <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-y-auto px-5 py-6 text-white sm:gap-7">
        <div className="flex flex-col items-center">
          <div className="relative h-24 w-24 sm:h-28 sm:w-28">
            <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
              <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="11" />
              <circle
                cx="80" cy="80" r={R} fill="none" stroke="white" strokeWidth="11" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - ring / 100)}
                className="transition-[stroke-dashoffset] duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[30px] font-black leading-none tabular-nums sm:text-[34px]">{ring}<span className="text-[17px]">%</span></span>
            </div>
            <div className="animate-ping-slow absolute inset-0 rounded-full ring-2 ring-white/30" />
          </div>
          <p className="mt-3 rounded-full bg-white/15 px-4 py-1.5 text-[12.5px] font-semibold tracking-wide backdrop-blur">
            {step === 0 || !weekCount
              ? STEP_LABELS[step]
              : `${STEP_LABELS[step]} ${weekCount.toLocaleString()} ${kind === 'hotlist' ? 'consultants' : 'jobs'} · last 7 days`}
          </p>
        </div>

        <div key={feature.key} className="animate-fade-in-up flex flex-col items-center text-center">
          <ScreenShot shot={feature.shot} t={t} />
          <h2 className="mt-5 text-[28px] font-black leading-tight tracking-tight drop-shadow-sm sm:text-[36px]">{feature.title}</h2>
          {cta && <div className="mt-4 flex h-11 items-center">{cta}</div>}
        </div>

        <div className="flex gap-2">
            {FEATURES.map((f, i) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setTick(i * TICKS_PER_SLIDE)}
                aria-label={f.title}
                className={`h-2.5 rounded-full transition-all ${i === index ? 'w-8 bg-white' : 'w-2.5 bg-white/40 hover:bg-white/70'}`}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
