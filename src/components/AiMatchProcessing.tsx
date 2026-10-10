import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, Mail, Smartphone } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { enableWebPush } from '../lib/onesignal';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';
import LeadCard, { jobRowToLead, type LeadCardProps, type SocialJobRow, type SocialLead } from './LeadCard';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';

// A match usually takes 30-50s. The bar and the countdown are paced on this
// until scoring reports real progress.
const EXPECTED_SECONDS = 40;
// Three steps in about 27s: the whole story fits inside one wait.
const STEP_MS = 9000;
const TICK_MS = 450;

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

// ---- Example matches, drawn with the real AI Match card. Made-up jobs. ----

const EXAMPLES: Array<{ row: Partial<SocialJobRow>; reason: string }> = [
  {
    row: { job_title: 'Java Full Stack Developer', company_name: 'Northwind Staffing', location: 'Dallas, TX', employment_type: 'C2C', extracted_experience_years: 10, extracted_visa_types: ['H1B'], extracted_hourly_rate_min: 62, extracted_hourly_rate_max: 68 },
    reason: 'Java, Spring Boot, React and H1B all match.',
  },
  {
    row: { job_title: 'Senior Java Microservices Engineer', company_name: 'Bluefield Tech', location: 'Remote', employment_type: 'C2C', extracted_experience_years: 9, extracted_hourly_rate_min: 70, extracted_hourly_rate_max: 72 },
    reason: 'Microservices and AWS fit; remote is open.',
  },
  {
    row: { job_title: 'Full Stack Engineer (Java / React)', company_name: 'Summit IT Partners', location: 'Austin, TX', employment_type: 'Contract', extracted_experience_years: 8, extracted_visa_types: ['H1B', 'GC'], extracted_hourly_rate_min: 60, extracted_hourly_rate_max: 65 },
    reason: 'Strong React overlap; Texas, open to relocate.',
  },
];

function exampleLeads(): SocialLead[] {
  return EXAMPLES.map((e, i) => {
    const at = new Date(Date.now() - (i * 17 + 4) * 60_000).toISOString();
    const lead = jobRowToLead({
      id: `example-${i}`, platform: 'linkedin', posted_by_name: e.row.company_name ?? '', poster_email: 'example@example.com', poster_phone: '',
      avatar_url: null, created_at: at, posted_at: at, post_content: '', extracted_role_normalized: '', seniority_level: '', salary_range: '',
      extracted_skills: [], extracted_visa_types: [], post_source: 'linkedin_scrape', post_url: null, created_by_account_id: null, created_by_user_id: null,
      ...e.row,
    } as SocialJobRow);
    return { ...lead, aiMatchScore: 9 - i, aiMatchReason: e.reason };
  });
}

const noop = () => {};

function ExampleCard({ lead, index, isDark, selectable, selected, show }: {
  lead: SocialLead; index: number; isDark: boolean; selectable?: boolean; selected?: boolean; show: boolean;
}) {
  const props: LeadCardProps = {
    lead, accountId: undefined, userId: undefined, paletteIndex: index, isDark, isHotlistFeed: false, feedTimeBasis: 'posted',
    isLeadRevealed: false, globalAskedJobState: undefined, predictResult: undefined, askedRequestedAt: undefined, askedFulfilledAt: undefined,
    revealedAt: undefined, isInlineBreakdownExpanded: false, isSkillsExpanded: false, isExpFieldExpanded: false,
    isWorkTypeFieldExpanded: false, isEmpTypeFieldExpanded: false, isRateFieldExpanded: false, isVisaFieldExpanded: false,
    isLocationFieldExpanded: false, isLoadingPreview: false, isProcessingAskAI: false, onPreview: noop, onAskAI: noop,
    onToggleInlineBreakdown: noop, onExpandSkills: noop, onCollapseSkills: noop, onToggleField: noop,
    hideActions: true, matchRank: index + 1, bulkSelectable: selectable, isBulkSelected: selected, onToggleBulkSelect: noop,
  };
  return (
    <div className={`pointer-events-none transition-all duration-500 ease-out ${show ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
      <LeadCard {...props} />
    </div>
  );
}

// Step 1: results arrive one by one, ranked, each with its reason.
function RankedScene({ t, leads, isDark }: { t: number; leads: SocialLead[]; isDark: boolean }) {
  return (
    <div className="space-y-2">
      {leads.map((l, i) => <ExampleCard key={l.id} lead={l} index={i} isDark={isDark} show={t >= 1 + i * 3} />)}
    </div>
  );
}

// Step 2: tick the best, send them together from Gmail. The bar is the AI
// Match page's own bulk-send bar.
function BulkScene({ t, leads, isDark }: { t: number; leads: SocialLead[]; isDark: boolean }) {
  const ticked = t >= 9 ? 3 : t >= 6 ? 2 : t >= 3 ? 1 : 0;
  const pressing = t === 11;
  const sent = t >= 12 ? Math.min(3, t - 11) : 0;
  const done = sent >= 3 && t >= 15;
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 shadow-sm">
        {done ? (
          <div className="flex items-center gap-2.5 px-4 py-3.5 text-[13.5px] font-semibold text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15"><Check size={16} strokeWidth={3} /></span>
            3 invites sent from your Gmail · replies come to your inbox
          </div>
        ) : sent > 0 ? (
          <div className="px-4 py-3.5 text-white">
            <p className="text-[13.5px] font-semibold">Sending {sent} of 3…</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white transition-all duration-300" style={{ width: `${(sent / 3) * 100}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15"><Mail size={16} className="text-white" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-white">{ticked ? `Send bulk invite to the ${ticked} selected` : 'Send bulk invite to all matches'}</p>
              <p className="truncate text-[12px] text-white/75">{ticked ? 'From your own Gmail' : 'Or select below to choose who'}</p>
            </div>
            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-[12.5px] font-bold text-indigo-700 shadow-sm transition-transform duration-200 ${pressing ? 'scale-90 ring-4 ring-white/40' : ''}`}>
              <Mail size={14} />Send Now
            </span>
          </div>
        )}
      </div>
      {leads.map((l, i) => <ExampleCard key={l.id} lead={l} index={i} isDark={isDark} show selectable selected={i < ticked} />)}
    </div>
  );
}

// Step 3: what lands on the phone, as the phone shows it. No device frame:
// the notification is the product.
const ALERTS = [
  { title: 'New match for your Java consultant', body: 'Java Full Stack Developer · Dallas, TX · $65/hr' },
  { title: 'Strong match landed', body: 'Senior Java Microservices Engineer · Remote' },
  { title: '3 new requirements fit Anitha', body: 'Data Engineer · Python, Snowflake · C2C' },
];

function PhoneScene({ t }: { t: number }) {
  const count = t >= 11 ? 3 : t >= 6 ? 2 : t >= 1 ? 1 : 0;
  return (
    <div className="mx-auto w-full max-w-[380px] space-y-2 pt-2">
      {ALERTS.slice(0, count).reverse().map((a, i) => (
        <div
          key={a.title}
          className={`rounded-2xl bg-white p-3.5 text-left shadow-lg shadow-black/10 ring-1 ring-black/5 dark:bg-[#2a2e35] dark:ring-white/10 ${i === 0 ? 'motion-safe:animate-drop-in' : ''}`}
        >
          <div className="flex items-center gap-2 text-[11.5px] text-gray-500 dark:text-slate-400">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gray-900 dark:bg-white">
              <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true">
                <circle cx="2.2" cy="2.6" r="1.8" fill="#facc15" /><circle cx="2.2" cy="7.4" r="1.8" fill="#f97316" />
                <polyline points="6,1 10,5 6,9" fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="font-medium">ProfilePush</span>
            <span>·</span>
            <span>{i === 0 ? 'now' : `${i * 4}m`}</span>
          </div>
          <p className="mt-1.5 text-[14px] font-semibold text-gray-900 dark:text-white">{a.title}</p>
          <p className="mt-0.5 text-[13px] text-gray-600 dark:text-slate-300">{a.body}</p>
        </div>
      ))}
    </div>
  );
}

type Step = { key: 'ranked' | 'bulk' | 'phone'; title: string; detail: string };

const STEPS: Step[] = [
  { key: 'ranked', title: 'Your best matches, ranked', detail: 'Each one scored and explained, best first.' },
  { key: 'bulk', title: 'Send them all from your Gmail', detail: 'Tick the ones you want, one click sends them. Replies land in your inbox.' },
  { key: 'phone', title: 'New matches on your phone', detail: 'An alert the moment a new requirement fits your consultant.' },
];

// Full screen while AI Match runs: the progress of this match, then what
// happens next, told with the app's own cards in about the time the wait takes.
export default function AiMatchProcessing({ kind, subject, phase, pct, gmailConnected, onConnectGmail }: {
  kind: 'jobs' | 'hotlist';
  /** What they asked to match, shown back so the wait is about their search. */
  subject?: string;
  phase: string | null;
  pct: number | null;
  gmailConnected: boolean;
  onConnectGmail: () => void;
}) {
  const { isDark } = useTheme();
  const native = Capacitor.isNativePlatform();
  const leads = useMemo(exampleLeads, []);
  const [pushState, setPushState] = useState<NotificationPermission | 'unsupported'>(() => (
    typeof window !== 'undefined' && 'Notification' in window && !native ? Notification.permission : 'unsupported'
  ));
  const [weekCount, setWeekCount] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const stepStartedAt = useRef(Date.now());
  const scoringFrom = useRef<{ at: number; pct: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(4);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
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

  // Advance through the steps; after the last, start again.
  const inStep = now - stepStartedAt.current;
  useEffect(() => {
    if (inStep >= STEP_MS) {
      stepStartedAt.current = Date.now();
      setActive((a) => (a + 1) % STEPS.length);
    }
  }, [inStep]);
  const goTo = (i: number) => { stepStartedAt.current = Date.now(); setNow(Date.now()); setActive(i); };
  const t = Math.floor(Math.min(inStep, STEP_MS - 1) / TICK_MS);

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
  const leftLabel = left > 4 ? `about ${Math.ceil(left / 5) * 5}s left` : 'almost done';
  const noun = kind === 'hotlist' ? 'consultants' : 'jobs';
  const status = step === 0 ? 'Reading what you pasted'
    : weekCount ? `Searching ${weekCount.toLocaleString()} ${noun} from the last 7 days` : `Searching the last 7 days of ${noun}`;
  const heading = kind === 'hotlist' ? 'Finding consultants for your requirement' : 'Finding jobs for your consultant';

  const current = STEPS[active];
  const action = (() => {
    const quiet = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10';
    const ok = 'inline-flex h-9 items-center gap-1.5 text-[13px] font-semibold text-emerald-600 dark:text-emerald-400';
    if (current.key === 'bulk') {
      return gmailConnected
        ? <span className={ok}><Check size={15} strokeWidth={3} />Gmail connected</span>
        : <button type="button" onClick={onConnectGmail} className={quiet}><Mail size={15} />Connect Gmail</button>;
    }
    if (current.key === 'phone') {
      if (!native) return <a href={PLAY_URL} target="_blank" rel="noreferrer" className={quiet}><Smartphone size={15} />Get the Android app</a>;
      if (pushState === 'granted') return <span className={ok}><Check size={15} strokeWidth={3} />Alerts are on</span>;
      return <button type="button" onClick={() => { void enableWebPush().then(setPushState); }} className={quiet}><Bell size={15} />Turn on alerts</button>;
    }
    return null;
  })();

  const scene = current.key === 'ranked' ? <RankedScene t={t} leads={leads} isDark={isDark} />
    : current.key === 'bulk' ? <BulkScene t={t} leads={leads} isDark={isDark} />
    : <PhoneScene t={t} />;

  return (
    <div className="fixed inset-0 z-[65] overflow-y-auto bg-[#f3f2ee] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100" role="dialog" aria-modal="true" aria-label="AI Match in progress">
      <div className="mx-auto grid min-h-full w-full max-w-5xl grid-cols-1 content-start gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:content-center lg:gap-12 lg:py-10">
        {/* Left: this match, then the three steps that follow it. */}
        <div className="flex min-w-0 flex-col">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#20242a]">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">AI Match</p>
            <p className="mt-1 text-[18px] font-bold leading-snug">{heading}</p>
            {subject && <p className="mt-1 truncate text-[13px] text-gray-500 dark:text-slate-400">“{subject}”</p>}
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-[13px] text-gray-600 dark:text-slate-300">{status}</span>
              <span className="text-[15px] font-bold tabular-nums">{percent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
              <div className="h-full rounded-full bg-blue-600 transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-2 text-[12px] tabular-nums text-gray-400">{leftLabel}</p>
          </div>

          <p className="mt-6 hidden px-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 lg:block">When your matches arrive</p>
          <ol className="mt-2 hidden space-y-1 lg:block">
            {STEPS.map((s, i) => {
              const on = i === active;
              return (
                <li key={s.key} className={`relative overflow-hidden rounded-xl transition-colors ${on ? 'bg-white shadow-sm dark:bg-[#20242a]' : 'hover:bg-white/60 dark:hover:bg-white/5'}`}>
                  <button type="button" onClick={() => goTo(i)} className="w-full px-3.5 py-3 text-left">
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${on ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-slate-300'}`}>{i + 1}</span>
                      <div className="min-w-0">
                        <p className={`text-[14.5px] font-semibold ${on ? '' : 'text-gray-600 dark:text-slate-400'}`}>{s.title}</p>
                        {on && <p className="mt-0.5 text-[13px] leading-snug text-gray-600 dark:text-slate-300">{s.detail}</p>}
                      </div>
                    </div>
                  </button>
                  {on && action && <div className="-mt-1 pb-3.5 pl-[3.25rem] pr-3.5">{action}</div>}
                  {/* How long until the next step: the list advances on its own. */}
                  {on && <span className="absolute bottom-0 left-0 h-0.5 bg-blue-600/70 transition-[width] duration-500 ease-linear" style={{ width: `${Math.min(100, (inStep / STEP_MS) * 100)}%` }} />}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Right: the step itself, in the app's own components. */}
        <div className="flex min-w-0 flex-col lg:min-h-[420px] lg:justify-center">
          {/* Phones: just the step on show, its action and where it sits in the three. */}
          <div className="mb-3 lg:hidden">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">When your matches arrive</p>
              <div className="flex gap-1.5">
                {STEPS.map((st, i) => (
                  <button key={st.key} type="button" onClick={() => goTo(i)} aria-label={st.title} className={`h-1.5 rounded-full transition-all ${i === active ? 'w-5 bg-blue-600' : 'w-1.5 bg-gray-300 dark:bg-white/20'}`} />
                ))}
              </div>
            </div>
            <p className="mt-2 text-[16px] font-bold">{current.title}</p>
            <p className="mt-0.5 text-[13.5px] leading-snug text-gray-600 dark:text-slate-300">{current.detail}</p>
            {action && <div className="mt-2.5">{action}</div>}
          </div>
          <div key={current.key} className="w-full min-w-0 motion-safe:animate-fade-in-up">{scene}</div>
        </div>
      </div>
    </div>
  );
}
