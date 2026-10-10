import { useEffect, useState, type ReactNode } from 'react';
import { Bell, Building2, Check, ExternalLink, Mail, Send } from 'lucide-react';
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

// ---- Animated mock-ups of the app. `t` counts ticks since the slide began. ----

function Frame({ children, url }: { children: ReactNode; url?: string }) {
  return (
    <div className="w-[330px] overflow-hidden rounded-2xl bg-white text-left text-gray-900 shadow-2xl shadow-black/30 ring-1 ring-black/5 sm:w-[400px]">
      <div className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        {url && <span className="ml-2 truncate rounded-md bg-white px-2 py-0.5 text-[10px] text-gray-400 ring-1 ring-gray-200">{url}</span>}
      </div>
      <div className="h-[262px] p-3">{children}</div>
    </div>
  );
}

const MOCK_JOBS = [
  { title: 'Java Full Stack Developer', who: 'Prime vendor · Dallas, TX', rate: '$65/hr' },
  { title: 'Senior Java Engineer', who: 'Implementation partner · Remote', rate: '$70/hr' },
  { title: 'Spring Boot Developer', who: 'Direct client · Austin, TX', rate: '$62/hr' },
];

function GmailMock({ t }: { t: number }) {
  const sent = t >= 6;
  return (
    <Frame url="profilepush.ai/today">
      <div className="space-y-2">
        {MOCK_JOBS.map((j, i) => {
          const checked = t >= i + 1;
          return (
            <div key={j.title} className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-all duration-300 ${checked ? 'border-blue-300 bg-blue-50/60' : 'border-gray-200'}`}>
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300'}`}>
                {checked && <Check size={11} strokeWidth={3.5} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-blue-700">{j.title}</p>
                <p className="truncate text-[10px] text-gray-500">{j.who} · {j.rate}</p>
              </div>
              {sent && <span className="animate-fade-in-up rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Sent</span>}
            </div>
          );
        })}
      </div>
      <div className={`mt-3 flex h-9 items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold text-white transition-all duration-300 ${sent ? 'bg-emerald-600' : t >= 4 ? 'scale-95 bg-blue-700' : 'bg-blue-600'}`}>
        {sent ? <><Check size={14} strokeWidth={3} />3 sent from your Gmail · resume attached</> : t >= 4 ? 'Sending…' : <><Send size={13} />Send selected</>}
      </div>
    </Frame>
  );
}

const MOCK_ALERTS = [
  { who: 'Ravi K.', job: 'Java Developer · Dallas, TX · $65/hr' },
  { who: 'Anitha R.', job: 'Data Engineer · Remote · $70/hr' },
  { who: 'Suresh M.', job: 'DevOps Engineer · Charlotte, NC' },
];

function PushMock({ t }: { t: number }) {
  const shown = MOCK_ALERTS.slice(0, Math.min(3, Math.max(0, Math.floor((t - 1) / 2) + 1)));
  return (
    <div className="relative h-[330px] w-[250px] overflow-hidden rounded-[2.2rem] border-[6px] border-gray-900 bg-gradient-to-b from-slate-700 to-slate-900 shadow-2xl shadow-black/40">
      <div className="mx-auto mt-1.5 h-4 w-20 rounded-full bg-gray-900" />
      <p className="mt-3 text-center text-[34px] font-light leading-none text-white">9:41</p>
      <div className="mt-4 space-y-2 px-2.5">
        {[...shown].reverse().map((a) => (
          <div key={a.who} className="animate-fade-in-up rounded-2xl bg-white/90 p-2.5 text-left shadow-lg backdrop-blur">
            <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
              <span className="flex h-4 w-4 items-center justify-center rounded bg-blue-600 text-white"><Bell size={9} /></span>
              ProfilePush · now
            </div>
            <p className="mt-1 text-[11.5px] font-bold text-gray-900">New match for {a.who}</p>
            <p className="truncate text-[10.5px] text-gray-600">{a.job}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const FIRMS = ['TEKsystems', 'Randstad', 'Kforce', 'Insight Global', 'Judge', 'Apex Systems', 'Pyramid', 'Mindlance'];

function CareerMock({ t }: { t: number }) {
  const opened = t >= 3;
  const fields = Math.max(0, Math.min(3, t - 3));
  const applied = t >= 7;
  return (
    <Frame url={opened ? 'careers.teksystems.com/job/48213' : 'profilepush.ai/feed'}>
      {!opened ? (
        <div className="space-y-2">
          {['Java Full Stack Developer', 'Cloud Engineer'].map((title, i) => (
            <div key={title} className="rounded-lg border border-gray-200 px-2.5 py-2">
              <p className="text-[12px] font-semibold text-blue-700">{title}</p>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-gray-500">
                <span className="font-medium text-gray-700">{i === 0 ? 'TEKsystems' : 'Randstad'}</span>
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 text-emerald-700"><Building2 size={9} />Career site</span>
                <span className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold transition-all ${i === 0 && t >= 2 ? 'scale-95 bg-blue-700 text-white' : 'bg-blue-50 text-blue-600'}`}>
                  <ExternalLink size={10} />Apply
                </span>
              </div>
            </div>
          ))}
          <div className="overflow-hidden pt-2">
            <div className="flex w-max animate-marquee gap-2">
              {[...FIRMS, ...FIRMS].map((f, i) => (
                <span key={i} className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-semibold text-gray-600">{f}</span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="animate-fade-in-up">
          <p className="text-[13px] font-bold">Java Full Stack Developer</p>
          <p className="text-[10px] text-gray-500">TEKsystems · Dallas, TX · Contract</p>
          <div className="mt-3 space-y-2">
            {['Full name', 'Email', 'Resume'].map((label, i) => (
              <div key={label}>
                <p className="text-[9px] font-semibold uppercase text-gray-400">{label}</p>
                <div className="mt-0.5 h-6 rounded-md border border-gray-200 px-2 text-[10.5px] leading-6 text-gray-700">
                  {i < fields && <span className="animate-fade-in-up inline-block">{['Ravi Kumar', 'ravi@…', 'Ravi_Kumar_Java.pdf'][i]}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className={`mt-3 flex h-8 items-center justify-center gap-1.5 rounded-lg text-[11.5px] font-semibold text-white transition-colors ${applied ? 'bg-emerald-600' : 'bg-gray-900'}`}>
            {applied ? <><Check size={13} strokeWidth={3} />Applied · tracked in ProfilePush</> : 'Submit application'}
          </div>
        </div>
      )}
    </Frame>
  );
}

function TrackerMock({ t }: { t: number }) {
  const col = t < 3 ? 0 : t < 6 ? 1 : 2;
  const columns = ['New', 'Submitted', 'Replied'];
  const card = (
    <div className="animate-fade-in-up rounded-lg border-2 border-blue-500 bg-white p-2 shadow-lg">
      <p className="text-[10.5px] font-bold text-blue-700">Java Full Stack Developer</p>
      <p className="text-[9px] text-gray-500">Ravi K. · $65/hr</p>
      {col === 2 && <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 text-[9px] font-semibold text-emerald-700"><Mail size={8} />Reply received</p>}
    </div>
  );
  return (
    <Frame url="profilepush.ai/tracker">
      <div className="grid h-full grid-cols-3 gap-2">
        {columns.map((name, i) => (
          <div key={name} className="flex flex-col gap-1.5 rounded-lg bg-gray-50 p-1.5">
            <p className="flex items-center justify-between px-0.5 text-[9.5px] font-semibold uppercase text-gray-500">
              {name}<span className="rounded-full bg-white px-1.5 text-gray-400">{[4, 2, 1][i] + (col === i ? 1 : 0)}</span>
            </p>
            {col === i && <div key={`${name}-${col}`}>{card}</div>}
            {[0, 1].slice(0, i === 2 ? 1 : 2).map((k) => (
              <div key={k} className="rounded-lg border border-gray-200 bg-white p-2">
                <div className="h-1.5 w-4/5 rounded bg-gray-200" />
                <div className="mt-1 h-1.5 w-1/2 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}

type Feature = { key: string; bg: string; blobA: string; blobB: string; title: string; mock: (t: number) => ReactNode };

const FEATURES: Feature[] = [
  { key: 'gmail', bg: 'from-rose-500 via-orange-500 to-amber-400', blobA: 'bg-yellow-300', blobB: 'bg-fuchsia-500', title: 'Bulk send from your Gmail', mock: (t) => <GmailMock t={t} /> },
  { key: 'push', bg: 'from-fuchsia-600 via-pink-500 to-orange-400', blobA: 'bg-yellow-300', blobB: 'bg-violet-600', title: 'Alerts the moment it matches', mock: (t) => <PushMock t={t} /> },
  { key: 'career', bg: 'from-emerald-500 via-teal-500 to-cyan-500', blobA: 'bg-lime-300', blobB: 'bg-blue-600', title: 'Apply on 40+ career sites', mock: (t) => <CareerMock t={t} /> },
  { key: 'tracker', bg: 'from-violet-700 via-purple-600 to-pink-500', blobA: 'bg-sky-400', blobB: 'bg-rose-400', title: 'Every submission tracked', mock: (t) => <TrackerMock t={t} /> },
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
    if (feature.key === 'push') {
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

      <div className="relative flex h-full flex-col items-center justify-between overflow-y-auto px-5 py-8 text-white sm:py-10">
        <div className="flex flex-col items-center">
          <div className="relative h-28 w-28 sm:h-32 sm:w-32">
            <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
              <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="11" />
              <circle
                cx="80" cy="80" r={R} fill="none" stroke="white" strokeWidth="11" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - ring / 100)}
                className="transition-[stroke-dashoffset] duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[34px] font-black leading-none tabular-nums sm:text-[38px]">{ring}<span className="text-[17px]">%</span></span>
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
          <div className="animate-float-soft">{feature.mock(t)}</div>
          <h2 className="mt-6 text-[28px] font-black leading-tight tracking-tight drop-shadow-sm sm:text-[40px]">{feature.title}</h2>
          <div className="mt-4 flex h-11 items-center">{cta}</div>
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
