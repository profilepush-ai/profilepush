import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Link } from 'react-router-dom';
import { enableWebPush } from '../lib/onesignal';
import { supabase } from '../lib/supabase';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';
const DISPLAY_FONT_URL = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap';

// A match usually takes 30-50s. The bar and the countdown are paced on this
// until scoring reports real progress.
const EXPECTED_SECONDS = 40;
// Each slide stays up this long; the three cycle about twice in one wait.
const SLIDE_MS = 7000;

function stepOf(phase: string | null): number {
  const p = (phase ?? '').toLowerCase();
  if (p.startsWith('scoring') || p.startsWith('saved')) return 2;
  if (p.startsWith('searching') || p.startsWith('found')) return 1;
  return 0;
}

// The marketing slides' look, scoped to this screen.
const CSS = `
.amw { --amw-display: "Plus Jakarta Sans", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-family: var(--amw-display);
  background: radial-gradient(120% 80% at 50% 0%, #1f3fd1 0%, #172fa3 100%); background-color: #172fa3; color: #fff; }
.amw-h1 { margin: 0; font-size: clamp(34px, 7vw, 56px); line-height: 1.02; font-weight: 800; letter-spacing: -0.03em; text-wrap: balance; }
.amw-slide { animation: amw-in .6s cubic-bezier(.2,.8,.2,1); }
@keyframes amw-in { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }
.amw-visual { position: relative; height: 290px; margin: 30px auto; max-width: 420px; animation: amw-float 5s ease-in-out infinite; }
@keyframes amw-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
.amw-cta { display: inline-flex; align-items: center; gap: 8px; height: 52px; padding: 0 28px; border-radius: 99px; background: #fff; color: #172fa3; font-weight: 800; font-size: 16px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.amw-cta:focus-visible, .amw-dot:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
.amw-done { display: inline-flex; align-items: center; gap: 8px; height: 52px; padding: 0 24px; border-radius: 99px; background: rgba(255,255,255,.16); color: #fff; font-weight: 800; font-size: 16px; }
.amw-dot { width: 8px; height: 8px; border-radius: 99px; background: rgba(255,255,255,.35); transition: width .3s, background .3s; }
.amw-dot.on { width: 26px; background: #fff; }
.amw-card { background: #fff; color: #0f172a; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
.amw-mail { position: absolute; left: 50%; width: 330px; max-width: 86vw; border-radius: 20px; text-align: left; }
.amw-mail.back { top: 26px; transform: translateX(-46%) rotate(6deg); opacity: .55; height: 220px; }
.amw-mail.front { top: 8px; transform: translateX(-54%) rotate(-3deg); padding: 18px 20px; }
.amw-ln { height: 9px; border-radius: 5px; background: #eef2f7; margin-top: 9px; }
.amw-badge { position: absolute; display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 99px; background: #10b981; color: #fff; font-size: 14px; font-weight: 800; white-space: nowrap; box-shadow: 0 12px 30px rgba(0,0,0,.3); }
.amw-fan { position: absolute; left: 50%; top: 40px; width: 0; height: 0; }
.amw-env { position: absolute; width: 150px; height: 100px; left: -75px; top: 0; border-radius: 14px; transform-origin: 50% 160%; }
.amw-env::before { content: ""; position: absolute; inset: 0; border-radius: 14px; background: linear-gradient(155deg, transparent 49%, #e2e8f0 50%, transparent 51%), linear-gradient(205deg, transparent 49%, #e2e8f0 50%, transparent 51%); background-size: 50% 60%; background-repeat: no-repeat; background-position: left top, right top; }
.amw-env::after { content: ""; position: absolute; left: 16px; right: 16px; bottom: 16px; height: 8px; border-radius: 4px; background: #eef2f7; }
.amw-alert { position: absolute; left: 50%; width: 340px; max-width: 88vw; display: flex; gap: 12px; align-items: flex-start; padding: 16px 18px; border-radius: 22px; text-align: left; }
.amw-alert.a1 { top: 18px; transform: translateX(-50%) rotate(-2deg); z-index: 3; }
.amw-alert.a2 { top: 124px; transform: translateX(-46%) rotate(2deg) scale(.95); z-index: 2; opacity: .92; }
.amw-alert.a3 { top: 220px; transform: translateX(-53%) rotate(-1deg) scale(.9); z-index: 1; opacity: .75; }
@media (max-width: 420px) { .amw-visual { height: 270px; } }
@media (prefers-reduced-motion: reduce) { .amw-slide, .amw-visual { animation: none; } }
`;

function AppIcon() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-slate-900">
      <svg width="22" height="18" viewBox="0 0 12 10" aria-hidden="true">
        <circle cx="2.2" cy="2.6" r="1.8" fill="#facc15" /><circle cx="2.2" cy="7.4" r="1.8" fill="#f97316" />
        <polyline points="6,1 10,5 6,9" fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// Free vs paid, side by side: what the free plan gives and what paying adds.
function PlansVisual({ paid }: { paid: boolean }) {
  const row = (label: string, free: string, pro: string) => (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-slate-100 py-2.5 text-[13.5px]">
      <span className="text-slate-500">{label}</span>
      <span className="w-[86px] text-right font-semibold text-slate-700">{free}</span>
      <span className="w-[96px] text-right font-extrabold text-blue-700">{pro}</span>
    </div>
  );
  return (
    <div className="amw-visual" aria-hidden="true">
      <div className="amw-card absolute left-1/2 top-4 w-[360px] max-w-[88vw] -translate-x-1/2 -rotate-1 rounded-[22px] px-5 pb-3 pt-4 text-left">
        <div className="grid grid-cols-[1fr_auto_auto] items-end gap-3 pb-2">
          <span />
          <span className={`w-[86px] text-right text-[12px] font-bold uppercase tracking-wide ${paid ? 'text-slate-400' : 'text-slate-700'}`}>Free</span>
          <span className="w-[96px] text-right text-[12px] font-bold uppercase tracking-wide text-blue-700">Paid</span>
        </div>
        {row('Matches a day', '10', 'Up to 100')}
        {row('Per consultant', 'Fixed', 'You choose')}
        {row('Minimum match', '50–80%', '50–80%')}
        {row('Price', '100 free', '₹0.25 each')}
      </div>
      <span className="amw-badge" style={{ left: '50%', bottom: 18, transform: 'translateX(-50%)' }}>₹250 = 1,000 matches</span>
    </div>
  );
}

// The two settings that shape every match: the minimum match % (real
// buttons, saved as tapped) and the daily match count.
function SettingsVisual({ minMatch, onMinMatch, paid, dailyCap }: { minMatch: number; onMinMatch: (v: number) => void; paid: boolean; dailyCap: number }) {
  return (
    <div className="amw-visual">
      <div className="amw-card absolute left-1/2 top-4 w-[360px] max-w-[88vw] -translate-x-1/2 rounded-[22px] p-5 text-left">
        <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400">Minimum match</p>
        <div className="mt-2 grid grid-cols-7 gap-1" role="radiogroup" aria-label="Minimum match">
          {[50, 55, 60, 65, 70, 75, 80].map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={minMatch === v}
              onClick={() => onMinMatch(v)}
              className={`h-9 rounded-lg text-[12.5px] font-extrabold tabular-nums transition-colors ${minMatch === v ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-slate-500">Higher means fewer, stronger matches.</p>
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
          <span>
            <span className="block text-[12px] font-bold uppercase tracking-wide text-slate-400">Daily matches</span>
            <span className="text-[13px] text-slate-500">{paid ? 'Per consultant, on the Tracker' : 'Per consultant, free plan'}</span>
          </span>
          <span className="text-[28px] font-extrabold tabular-nums text-slate-900">{dailyCap}</span>
        </div>
      </div>
    </div>
  );
}

const ALERTS = [
  { cls: 'a1', when: 'now', title: 'New match: Java Developer', body: 'Dallas, TX · $65/hr' },
  { cls: 'a2', when: '4m', title: 'Strong match landed', body: 'Senior Java Engineer · Remote' },
  { cls: 'a3', when: '9m', title: '3 new jobs fit Anitha', body: 'Data Engineer · C2C' },
];

function PhoneVisual() {
  return (
    <div className="amw-visual" aria-hidden="true">
      {ALERTS.map((a) => (
        <div key={a.cls} className={`amw-card amw-alert ${a.cls}`}>
          <AppIcon />
          <div>
            <span className="block text-[12px] font-semibold text-slate-500">ProfilePush · {a.when}</span>
            <span className="mt-0.5 block text-[15.5px] font-extrabold tracking-tight">{a.title}</span>
            <span className="mt-0.5 block text-[13.5px] text-slate-500">{a.body}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Full screen while AI Match runs: a thin progress strip for this match, then
// one marketing slide at a time: a headline, a picture and one button.
export default function AiMatchProcessing({ kind, phase, pct }: {
  kind: 'jobs' | 'hotlist';
  subject?: string;
  phase: string | null;
  pct: number | null;
  gmailConnected?: boolean;
  onConnectGmail?: () => void;
}) {
  const native = Capacitor.isNativePlatform();
  // The account's plan and settings, for the plans and settings slides.
  const [plan, setPlan] = useState<{ paid: boolean; dailyCap: number }>({ paid: false, dailyCap: 10 });
  const [minMatch, setMinMatch] = useState(70);
  const [savedMin, setSavedMin] = useState(false);
  useEffect(() => {
    void supabase.rpc('get_match_caps' as never).then(({ data }: { data: { paid?: boolean; default_cap?: number } | null }) => {
      if (data) setPlan({ paid: Boolean(data.paid), dailyCap: Number(data.default_cap ?? 10) });
    });
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: member } = await supabase.from('account_members').select('account_id').eq('user_id', data.user.id).eq('status', 'active').limit(1).maybeSingle();
      const accountId = (member as { account_id?: string } | null)?.account_id;
      if (!accountId) return;
      const { data: acct } = await supabase.from('accounts').select('match_min_score' as never).eq('id', accountId).maybeSingle();
      const v = (acct as { match_min_score?: number } | null)?.match_min_score;
      if (v) setMinMatch(v);
    });
  }, []);
  const changeMinMatch = (v: number) => {
    setMinMatch(v);
    setSavedMin(false);
    // Keep the settings slide up while they choose.
    slideFrom.current = Date.now();
    setSlideBase(2);
    void supabase.rpc('set_match_min_score' as never, { p_score: v } as never).then(({ error }) => { if (!error) setSavedMin(true); });
  };
  const [pushState, setPushState] = useState<NotificationPermission | 'unsupported'>(() => (
    typeof window !== 'undefined' && 'Notification' in window && !native ? Notification.permission : 'unsupported'
  ));
  const startedAt = useRef(Date.now());
  const scoringFrom = useRef<{ at: number; pct: number } | null>(null);
  const slideFrom = useRef(Date.now());
  const [slideBase, setSlideBase] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [shown, setShown] = useState(4);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (document.querySelector(`link[href="${DISPLAY_FONT_URL}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = DISPLAY_FONT_URL;
    document.head.appendChild(link);
  }, []);

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
  const leftLabel = left > 4 ? `~${Math.ceil(left / 5) * 5}s` : 'almost done';
  const heading = kind === 'hotlist' ? 'Finding consultants for your requirement' : 'Finding jobs for your consultant';

  const done = (label: string) => <span className="amw-done">✓ {label}</span>;
  const slides: Array<{ key: string; title: ReactNode; visual: ReactNode; action: ReactNode }> = [
    {
      key: 'plans',
      title: plan.paid ? <>Up to 100<br />matches a day.</> : <>10 free matches<br />a day.</>,
      visual: <PlansVisual paid={plan.paid} />,
      action: plan.paid ? done('You’re on paid') : <Link to="/billing" className="amw-cta">Upgrade from ₹100</Link>,
    },
    {
      key: 'app',
      title: <>Matches in<br />your pocket.</>,
      visual: <PhoneVisual />,
      action: !native
        ? <a href={PLAY_URL} target="_blank" rel="noreferrer" className="amw-cta">Get the Android app</a>
        : pushState === 'granted' ? done('Alerts on')
        : <button type="button" onClick={() => { void enableWebPush().then(setPushState); }} className="amw-cta">Turn on alerts</button>,
    },
    {
      key: 'settings',
      title: <>You set<br />the bar.</>,
      visual: <SettingsVisual minMatch={minMatch} onMinMatch={changeMinMatch} paid={plan.paid} dailyCap={plan.dailyCap} />,
      action: savedMin ? done(`Saved · ${minMatch}% minimum`) : null,
    },
  ];
  const index = (Math.floor((now - slideFrom.current) / SLIDE_MS) + slideBase) % slides.length;
  const slide = slides[index];
  const goTo = (i: number) => { slideFrom.current = Date.now(); setSlideBase(i); setNow(Date.now()); };

  return (
    <div className="amw fixed inset-0 z-[65] flex flex-col overflow-y-auto overflow-x-hidden px-4" role="dialog" aria-modal="true" aria-label="AI Match in progress">
      <style>{CSS}</style>
      <div className="mx-auto w-full max-w-[560px] pt-[calc(22px+env(safe-area-inset-top,0px))]" aria-live="polite">
        <div className="flex justify-between gap-3 text-[13.5px] font-semibold tabular-nums text-white/70">
          <span className="truncate">{heading}</span>
          <span className="shrink-0"><b className="text-white">{percent}%</b> · {leftLabel}</span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="grid flex-1 place-items-center pb-9 pt-6">
        <div className="w-full max-w-[560px] text-center">
          <section key={slide.key} className="amw-slide">
            <h1 className="amw-h1">{slide.title}</h1>
            {slide.visual}
            {slide.action}
          </section>
          <div className="mt-6 flex justify-center gap-2">
            {slides.map((s, i) => (
              <button key={s.key} type="button" onClick={() => goTo(i)} aria-label={`Slide ${i + 1}`} className={`amw-dot ${i === index ? 'on' : ''}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
