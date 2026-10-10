import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Briefcase, Building2, Check, Copy, DollarSign, ExternalLink, GraduationCap, Mail, MapPin, Paperclip, Send, type LucideIcon } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
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

function ConsultantHead({ submitted, fresh }: { submitted: number; fresh: number }) {
  return (
    <div className="bg-orange-100 px-4 pb-3 pt-3.5">
      <p className="flex items-center gap-2 text-[15px] font-bold text-gray-900"><span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />Java Fullstack Developer</p>
      <p className="mt-0.5 text-[12px] text-gray-600">10 yrs · H1B · Open to relocate</p>
      <div className="mt-2.5 flex gap-1.5 text-[12px]">
        <span className="rounded-full bg-white px-3 py-1 font-semibold text-gray-800 shadow-sm">New <b className="text-emerald-600 tabular-nums">{fresh}</b></span>
        <span className="rounded-full bg-white px-3 py-1 font-semibold text-gray-500 shadow-sm">Submitted <b className="tabular-nums text-gray-800">{submitted}</b></span>
      </div>
    </div>
  );
}

const REQS = [
  { title: 'Java Full Stack Developer', exp: '12', type: 'C2C', where: 'Wilmington, DE' },
  { title: 'Senior Full Stack Java Developer', exp: '10', type: 'C2C', where: 'Chicago, IL' },
  { title: 'Java Developer with Angular', exp: '15', type: 'C2C', where: 'Westlake, TX' },
  { title: 'Sr Java Developer', exp: '12', type: 'W2', where: 'Dallas, TX' },
  { title: 'Java Microservices Engineer', exp: '9', type: 'C2C', where: 'Remote' },
];

function ReqCard({ r, fresh, ago }: { r: (typeof REQS)[number]; fresh?: boolean; ago: string }) {
  return (
    <div className={`rounded-lg border-2 bg-white px-3 py-2.5 transition-colors ${fresh ? 'animate-drop-in border-emerald-400' : 'border-emerald-300/70'}`}>
      <p className="text-[14px] font-semibold text-blue-600">{r.title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Chip icon={GraduationCap}>{r.exp}</Chip><Chip icon={Briefcase}>{r.type}</Chip><Chip icon={MapPin}>{r.where}</Chip>
      </div>
      <p className="mt-1.5 flex items-center justify-between text-[11.5px] text-gray-400">
        <span>Posted {ago}</span>
        <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-gray-500"><span className="h-1.5 w-1.5 rounded-full bg-orange-500" />Requirement</span>
      </p>
    </div>
  );
}

function TrackerScene({ t }: { t: number }) {
  // A new requirement lands every two ticks, newest on top.
  const landed = Math.min(3, Math.floor(t / 2));
  const list = REQS.slice(3 - landed, 5);
  const toast = t >= 2 && t % 2 === 0 ? REQS[3 - landed] : null;
  return (
    <div className="relative w-[min(88vw,420px)] overflow-hidden rounded-2xl bg-orange-50 text-left shadow-2xl shadow-black/30">
      <ConsultantHead fresh={2 + landed} submitted={0} />
      <div className="h-[300px] space-y-2 overflow-hidden p-2.5">
        {list.map((r, i) => <ReqCard key={r.title} r={r} fresh={i === 0 && landed > 0} ago={i === 0 && landed > 0 ? 'just now' : `${(i + 1) * 7} mins ago`} />)}
      </div>
      {toast && (
        <div key={toast.title} className="animate-fade-in-up absolute inset-x-3 top-[112px] flex items-center gap-3 rounded-xl bg-gray-900 px-3.5 py-2.5 shadow-2xl">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"><Bell size={15} /></span>
          <div className="min-w-0">
            <p className="text-[12.5px] font-bold text-emerald-300">Strong match landed</p>
            <p className="truncate text-[13px] text-white">{toast.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}

const EMAIL_LINES = [
  'Hi,',
  'I have a Java Fullstack Developer with 10 years of experience, on H1B and open to relocate, for your Java Full Stack Developer role in Wilmington, DE.',
  '• Spring Boot, React, Microservices, AWS',
  '• Available immediately · $65/hr C2C',
  'Resume attached. Can we set up a call?',
];

function SubmitScene({ t }: { t: number }) {
  const lines = Math.max(0, Math.min(EMAIL_LINES.length, t - 1));
  const pressing = t === 7;
  const sent = t >= 8;
  return (
    <div className="w-[min(88vw,460px)] overflow-hidden rounded-2xl bg-white text-left shadow-2xl shadow-black/30">
      <div className="h-1.5 bg-gradient-to-r from-orange-400 to-orange-600" />
      <div className="px-4 pt-3">
        <div className="flex items-center gap-3 border-b border-gray-100 py-1.5 text-[12.5px]"><span className="w-14 text-gray-400">To</span><span className="text-gray-700">The recruiter on this requirement</span></div>
        <div className="flex items-center gap-3 border-b border-gray-100 py-1.5 text-[12.5px]"><span className="w-14 text-gray-400">Subject</span><span className="font-medium text-gray-900">Java Fullstack Developer: 10 yrs, H1B</span></div>
      </div>
      <div className="h-[196px] space-y-2 px-4 py-3 text-[13px] leading-relaxed text-gray-800">
        {EMAIL_LINES.slice(0, lines).map((l) => <p key={l} className="animate-fade-in-up">{l}</p>)}
        {lines < EMAIL_LINES.length && <span className="inline-block h-4 w-0.5 animate-pulse bg-blue-600 align-middle" />}
      </div>
      <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[11.5px] text-slate-700 transition-opacity ${t >= 6 ? 'opacity-100' : 'opacity-0'}`}><Paperclip size={12} />Java_Fullstack_Resume.pdf</span>
        <span className={`ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold text-white transition-all duration-300 ${sent ? 'bg-emerald-600' : pressing ? 'scale-95 bg-blue-700 ring-4 ring-blue-300' : 'bg-blue-600'}`}>
          {sent ? <><Check size={15} strokeWidth={3} />Sent from your Gmail</> : <><Send size={14} />Send</>}
        </span>
      </div>
    </div>
  );
}

const APPLY_ROWS: Array<[string, string]> = [
  ['Role', 'Senior Java Full Stack Developer'],
  ['Experience', '10 years'],
  ['Skills', 'Spring Boot, React, AWS'],
  ['Work auth', 'H1B'],
  ['Location', 'Dallas, TX'],
];

function ApplyScene({ t }: { t: number }) {
  const rows = Math.max(0, Math.min(APPLY_ROWS.length, t - 1));
  const pressing = t === 7;
  const applied = t >= 8;
  return (
    <div className="w-[min(88vw,440px)] space-y-2.5 text-left">
      <div className="rounded-2xl bg-white px-4 py-3 shadow-2xl shadow-black/30">
        <p className="text-[15px] font-semibold text-blue-600">Java Full Stack Developer</p>
        <div className="mt-1.5 flex flex-wrap gap-1"><Chip icon={Briefcase}>Contract</Chip><Chip icon={DollarSign}>$40–$45/hr</Chip><Chip icon={MapPin}>Weehawken, NJ</Chip></div>
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px]"><span className="font-medium text-slate-700">Diverse Lynx</span><CareerPill /><span className="text-gray-400">2 days ago</span></p>
      </div>
      <div className="overflow-hidden rounded-2xl bg-amber-50 shadow-2xl shadow-black/30">
        <p className="px-4 pt-3 text-[11px] font-bold uppercase tracking-wide text-amber-700">Application details</p>
        <div className="h-[178px] px-4 pb-1 pt-1">
          {APPLY_ROWS.slice(0, rows).map(([k, v], i) => (
            <div key={k} className="animate-fade-in-up flex items-center gap-3 border-b border-amber-100 py-1.5 text-[13px]">
              <span className="w-20 shrink-0 text-gray-400">{k}</span>
              <span className="flex-1 text-gray-800">{v}</span>
              {t === 6 && i === 2 ? <span className="text-[11px] font-semibold text-emerald-600">Copied</span> : <Copy size={13} className="text-gray-300" />}
            </div>
          ))}
        </div>
        <div className="flex gap-2 bg-white px-4 py-3">
          <span className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-gray-200 text-[13px] font-semibold text-gray-600">Skip</span>
          <span className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold text-white transition-all duration-300 ${applied ? 'bg-emerald-600' : pressing ? 'scale-95 bg-blue-700 ring-4 ring-blue-300' : 'bg-blue-600'}`}>
            {applied ? <><Check size={15} strokeWidth={3} />Applied · tracked</> : <><ExternalLink size={14} />Apply</>}
          </span>
        </div>
      </div>
    </div>
  );
}

type Feature = { key: string; title: string; scene: (t: number) => ReactNode };

const FEATURES: Feature[] = [
  { key: 'gmail', title: 'AI Submit, resume attached', scene: (t) => <SubmitScene t={t} /> },
  { key: 'career', title: 'Apply on 40+ career sites', scene: (t) => <ApplyScene t={t} /> },
  { key: 'tracker', title: 'Matches land all day', scene: (t) => <TrackerScene t={t} /> },
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
    if (feature.key === 'tracker') {
      if (pushState === 'granted') return done('Alerts on');
      if (pushState === 'default') return <button type="button" onClick={() => { void enableWebPush().then(setPushState); }} className={`${pill} bg-white text-gray-900`}><Bell size={17} />Turn on alerts</button>;
      return native ? null : <a href={PLAY_URL} target="_blank" rel="noreferrer" className={`${pill} bg-white text-gray-900`}>Get the app</a>;
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
