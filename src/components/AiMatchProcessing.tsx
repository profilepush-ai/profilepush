import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Briefcase, Building2, Check, DollarSign, Mail, MapPin, Send, Smartphone, Target, type LucideIcon } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Link } from 'react-router-dom';
import { enableWebPush } from '../lib/onesignal';
import { supabase } from '../lib/supabase';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';
const TICK_MS = 700;
const TICKS_PER_SLIDE = 11;

// A match usually takes 30-50s; the ring and the countdown are paced on this
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

// ---- Built scenes, in the app's own look (the landing page's approach): the
// Tracker column filling, the AI Submit email writing itself, and a career-site
// Apply. `t` counts ticks since the scene began.

function Chip({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  const Icon = icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] text-slate-700">
      <Icon size={11} className="text-gray-400" />{children}
    </span>
  );
}

function CareerPill() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-[1px] text-[11px] font-medium text-emerald-700">
      <Building2 size={11} />Career site
    </span>
  );
}

const REQS = [
  { title: 'Java Full Stack Developer', exp: '12', type: 'C2C', where: 'Wilmington, DE' },
  { title: 'Senior Full Stack Java Developer', exp: '10', type: 'C2C', where: 'Chicago, IL' },
  { title: 'Java Developer with Angular', exp: '15', type: 'C2C', where: 'Westlake, TX' },
  { title: 'Sr Java Developer', exp: '12', type: 'W2', where: 'Dallas, TX' },
  { title: 'Java Microservices Engineer', exp: '9', type: 'C2C', where: 'Remote' },
];

function GmailScene({ t }: { t: number }) {
  // Today's Gmail card: not connected → pick the account → connected.
  const picking = t >= 3 && t < 6;
  const connected = t >= 6;
  return (
    <div className="relative w-[min(88vw,400px)] text-left">
      <div className="rounded-2xl bg-white p-5 shadow-2xl shadow-black/30">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600"><Target size={22} /></span>
          <div>
            <p className="text-[12.5px] text-gray-500">Today&apos;s submissions</p>
            <p className="text-[28px] font-bold leading-tight tabular-nums text-gray-900">{connected && t >= 8 ? 1 : 0}</p>
          </div>
        </div>
        <p className="mt-2 text-[12.5px] text-gray-500">100 sends left today</p>
        {connected ? (
          <p className="animate-fade-in-up mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-emerald-600"><Check size={16} strokeWidth={3} />Gmail connected · sends go from your inbox</p>
        ) : (
          <span className={`mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg text-[13.5px] font-semibold text-white transition-all duration-300 ${t === 2 ? 'scale-95 bg-amber-700 ring-4 ring-amber-200' : 'bg-amber-600'}`}>
            <Mail size={15} />Connect Gmail to send
          </span>
        )}
      </div>
      {picking && (
        <div className="animate-fade-in-up absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-xl bg-white p-4 shadow-2xl ring-1 ring-black/10">
          <p className="text-[13px] font-bold text-gray-900">Choose an account</p>
          <p className="text-[11.5px] text-gray-500">to continue to ProfilePush</p>
          <div className={`mt-3 flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${t >= 5 ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-[13px] font-bold text-white">A</span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-gray-900">Alex Recruiter</p>
              <p className="truncate text-[11.5px] text-gray-500">alex@youragency.com</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const BULK_JOBS = [
  { title: 'Java Full Stack Developer', type: 'C2C', rate: '$65/hr', where: 'Wilmington, DE', by: 'Prime vendor' },
  { title: 'Senior Java Engineer', type: 'C2C', rate: '$70/hr', where: 'Remote', by: 'Implementation partner' },
  { title: 'Spring Boot Developer', type: 'W2', rate: '$62/hr', where: 'Austin, TX', by: 'Direct client' },
];

function BulkScene({ t }: { t: number }) {
  // Tick three matches, send them together, watch each go.
  const ticked = Math.min(3, Math.max(0, t));
  const pressing = t === 4;
  const sentCount = Math.max(0, Math.min(3, t - 4));
  return (
    <div className="w-[min(88vw,440px)] overflow-hidden rounded-2xl bg-white text-left shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold text-gray-900">Java Fullstack Developer</p>
          <p className="text-[12px] text-gray-500">26 fresh matches</p>
        </div>
        <span className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] font-semibold text-white transition-all duration-300 ${sentCount === 3 ? 'bg-emerald-600' : pressing ? 'scale-95 bg-blue-700 ring-4 ring-blue-300' : 'bg-blue-600'}`}>
          {sentCount === 3 ? <><Check size={14} strokeWidth={3} />3 sent</> : <><Send size={13} />Send {ticked || ''} selected</>}
        </span>
      </div>
      <div className="space-y-2 p-3">
        {BULK_JOBS.map((j, i) => {
          const on = i < ticked;
          const sent = i < sentCount;
          return (
            <div key={j.title} className={`rounded-lg border px-3 py-2.5 transition-colors duration-300 ${on ? 'border-blue-400 bg-blue-50/50' : 'border-gray-200'}`}>
              <div className="flex items-start gap-2.5">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'}`}>{on && <Check size={13} strokeWidth={3.5} />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-blue-600">{j.title}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1"><Chip icon={Briefcase}>{j.type}</Chip><Chip icon={DollarSign}>{j.rate}</Chip><Chip icon={MapPin}>{j.where}</Chip></div>
                  <p className="mt-1.5 text-[12px] text-gray-500">{j.by}</p>
                </div>
                {sent && <span className="animate-fade-in-up shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700">Sent</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AppScene({ t }: { t: number }) {
  // The Android app with a match alert landing on top of the Feed.
  const alert = t >= 2;
  return (
    <div className="relative h-[400px] w-[220px] overflow-hidden rounded-[2.4rem] border-[7px] border-gray-900 bg-[#f3f2ee] shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between bg-white px-3 pb-2 pt-5">
        <span className="text-[13px] font-extrabold text-gray-900">ProfilePush</span>
        <Bell size={14} className="text-blue-600" />
      </div>
      <div className="space-y-1.5 p-2">
        {REQS.slice(0, 4).map((r) => (
          <div key={r.title} className="rounded-lg bg-white px-2.5 py-2 text-left shadow-sm">
            <p className="truncate text-[11.5px] font-semibold text-blue-600">{r.title}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">{r.type} · {r.where}</p>
            <p className="mt-1 flex items-center gap-1 text-[9.5px]"><CareerPill /></p>
          </div>
        ))}
      </div>
      {alert && (
        <div className="animate-drop-in absolute inset-x-2 top-3 rounded-2xl bg-white/95 p-2.5 text-left shadow-xl ring-1 ring-black/5 backdrop-blur">
          <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-gray-500">
            <span className="flex h-4 w-4 items-center justify-center rounded bg-blue-600 text-white"><Bell size={9} /></span>ProfilePush · now
          </p>
          <p className="mt-1 text-[12px] font-bold text-gray-900">New match for your Java consultant</p>
          <p className="text-[11px] text-gray-600">Java Full Stack Developer · $65/hr</p>
        </div>
      )}
    </div>
  );
}

type Feature = { key: string; title: string; scene: (t: number) => ReactNode };

const FEATURES: Feature[] = [
  { key: 'gmail', title: 'Connect your Gmail', scene: (t) => <GmailScene t={t} /> },
  { key: 'bulk', title: 'Submit in bulk, one click', scene: (t) => <BulkScene t={t} /> },
  { key: 'app', title: 'Get matches on your phone', scene: (t) => <AppScene t={t} /> },
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
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  const [tick, setTick] = useState(0);
  const [pushState, setPushState] = useState<NotificationPermission | 'unsupported'>(() => (
    typeof window !== 'undefined' && 'Notification' in window && !native ? Notification.permission : 'unsupported'
  ));
  const [weekCount, setWeekCount] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const scoringFrom = useRef<{ at: number; pct: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [shown, setShown] = useState(5);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(id);
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
  const elapsed = (now - startedAt.current) / 1000;
  if (step === 2 && pct != null && !scoringFrom.current) scoringFrom.current = { at: now, pct };
  // Always moving: time-paced until scoring reports real progress, which then
  // carries the second half. Never goes backwards, never shows 100 early.
  const paced = 92 * (1 - Math.exp(-elapsed / 18));
  const real = step < 2 ? 8 + step * 20 : 50 + (pct ?? 0) * 0.48;
  const target = Math.min(99, Math.max(paced, real));
  useEffect(() => {
    setShown((cur) => (target > cur ? target : cur));
  }, [target]);
  const ring = Math.round(shown);
  // Seconds left: from the scoring rate once there is one, else the usual pace.
  const s0 = scoringFrom.current;
  let left = EXPECTED_SECONDS - elapsed;
  if (s0 && pct != null && pct > s0.pct + 3) {
    const rate = (pct - s0.pct) / ((now - s0.at) / 1000);
    left = (100 - pct) / rate;
  }
  const leftLabel = left > 4 ? `About ${Math.ceil(left / 5) * 5}s left` : 'Almost done';
  const noun = kind === 'hotlist' ? 'consultants' : 'jobs';
  const status = step === 0 ? 'Reading your profile'
    : weekCount ? `Matching against ${weekCount.toLocaleString()} ${noun} · last 7 days` : `Matching against the last 7 days of ${noun}`;
  const R = 70;
  const C = 2 * Math.PI * R;

  const pill = 'inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-bold shadow-xl shadow-black/20 transition-transform hover:scale-105';
  const done = (label: string) => <span className={`${pill} bg-white/20 text-white backdrop-blur`}><Check size={17} strokeWidth={3} />{label}</span>;
  const cta = (() => {
    if (feature.key === 'gmail') {
      return gmailConnected ? done('Gmail connected')
        : <button type="button" onClick={onConnectGmail} className={`${pill} bg-white text-gray-900`}><Mail size={17} />Connect Gmail</button>;
    }
    if (feature.key === 'bulk') {
      return <Link to={wide ? '/today' : '/tracker'} className={`${pill} bg-white text-gray-900`}><Send size={16} />Try bulk submit</Link>;
    }
    if (feature.key === 'app') {
      // In the app already: offer alerts instead.
      if (!native) return <a href={PLAY_URL} target="_blank" rel="noreferrer" className={`${pill} bg-white text-gray-900`}><Smartphone size={17} />Install the Android app</a>;
      if (pushState === 'granted') return done('Alerts on');
      return <button type="button" onClick={() => { void enableWebPush().then(setPushState); }} className={`${pill} bg-white text-gray-900`}><Bell size={17} />Turn on alerts</button>;
    }
    return null;
  })();

  return (
    <div className="fixed inset-0 z-[65] overflow-hidden bg-indigo-600" role="dialog" aria-modal="true" aria-label="AI Match in progress">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.14)_0%,transparent_60%)]" />

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
          <p className="mt-3 text-[15px] font-bold">{status}</p>
          <p className="mt-0.5 text-[13px] font-medium tabular-nums text-white/75">{leftLabel}</p>
        </div>

        <div key={feature.key} className="animate-fade-in-up flex flex-col items-center text-center">
          {feature.scene(t)}
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
