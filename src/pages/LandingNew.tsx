import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bookmark, Check, ChevronRight, Copy, DollarSign, ExternalLink, Gift, Mail, MapPin, MousePointerClick, Send, Share2, ShieldCheck, Sparkles, Timer, X } from 'lucide-react';
import Logo from '../components/Logo';
import SiteFooter from '../components/SiteFooter';
import { FitLine } from '../components/match/Visuals';
import { fetchMarketSnapshot, initialSnapshot, type MarketSnapshot } from '../lib/marketSnapshot';
import { priceLabels, useCurrency } from '../lib/currency';
import { trackEvent } from '../lib/track';
import { supabase } from '../lib/supabase';

// The landing page, rebuilt around what ProfilePush is now: daily matches
// as a reel with a picture each, apply in a tap (email or ProfilePush Apply
// on career sites), a tracker that's a sheet, pay per match. Every number on
// it is live (the market snapshot); the cards are examples.

const n = (v: number) => v.toLocaleString('en-US');

function Ticking() {
  const [s, setS] = useState(23 * 3600 + 41 * 60 + 7);
  useEffect(() => { const t = setInterval(() => setS((x) => (x > 0 ? x - 1 : 23 * 3600)), 1000); return () => clearInterval(t); }, []);
  const two = (v: number) => String(v).padStart(2, '0');
  return <>{Math.floor(s / 3600)}:{two(Math.floor(s / 60) % 60)}:{two(s % 60)} left</>;
}

// An example match card, as Today shows it.
function ReelCard() {
  return (
    <div className="relative w-[300px] overflow-hidden rounded-[26px] bg-[#0b0f1a] text-white shadow-[0_30px_80px_rgba(11,26,58,.35)] sm:w-[330px]" aria-label="An example match">
      <img src="/landing-v2/java.webp" alt="" className="h-[300px] w-full object-cover object-[50%_20%] sm:h-[320px]" style={{ maskImage: 'linear-gradient(180deg,#000 70%,transparent)', WebkitMaskImage: 'linear-gradient(180deg,#000 70%,transparent)' }} />
      <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">AI picture</span>
      <div className="-mt-10 space-y-3 px-4 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#2563EB] text-[17px] font-extrabold">N</span>
          <div className="min-w-0 flex-1"><b className="block text-[14px]">Northwind Tech</b><small className="text-[11.5px] text-white/70">Apply by email · 2h ago</small></div>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[11px] font-bold tabular-nums"><Timer size={11} /><Ticking /></span>
        </div>
        <h3 className="text-[22px] font-extrabold leading-tight tracking-tight">Senior Java Developer</h3>
        <FitLine value={91} onDark animate at={600} />
        <div className="flex flex-wrap gap-1.5 text-[12px] font-bold">
          {['Java', 'Spring Boot', 'AWS', 'React'].map((s) => <span key={s} className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-[#93c5fd] px-2 py-[2px]"><Check size={11} strokeWidth={3} />{s}</span>)}
          <span className="rounded-full border-[1.5px] border-dashed border-white/40 px-2 py-[2px] font-semibold text-white/65">Kafka</span>
        </div>
        <div className="grid grid-cols-4 gap-2 pt-1 text-center text-[10.5px] font-bold">
          {[[Send, 'Apply', 'bg-[#2563EB]'], [Bookmark, 'Save', 'bg-white/15'], [Share2, 'Share', 'bg-white/15'], [X, 'Pass', 'bg-white/15']].map(([Icon, label, bg]) => {
            const I = Icon as typeof Send;
            return <span key={label as string} className="flex flex-col items-center gap-1"><span className={`grid h-10 w-10 place-items-center rounded-full ${bg as string}`}><I size={17} /></span>{label as string}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

function Step({ n: num, title, text, children }: { n: number; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-[#20242a]">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-[#2563EB] text-[14px] font-extrabold text-white">{num}</span>
      <h3 className="text-[18px] font-extrabold tracking-tight">{title}</h3>
      <p className="text-[14px] leading-relaxed text-gray-600 dark:text-slate-400">{text}</p>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

function Feature({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#20242a]">
      <div className="grid min-h-[200px] place-items-center bg-[#eef3ff] p-5 dark:bg-white/5">{children}</div>
      <div className="p-5">
        <h3 className="text-[18px] font-extrabold tracking-tight">{title}</h3>
        <p className="mt-1 text-[14px] leading-relaxed text-gray-600 dark:text-slate-400">{text}</p>
      </div>
    </div>
  );
}

export default function LandingNew() {
  const [snap, setSnap] = useState<MarketSnapshot>(() => initialSnapshot());
  const [currency] = useCurrency();
  const price = priceLabels(currency);
  useEffect(() => { void fetchMarketSnapshot().then((s) => { if (s) setSnap(s); }); }, []);
  // People who've signed up (landing_user_count), live.
  const [users, setUsers] = useState<number | null>(null);
  useEffect(() => { void supabase.rpc('landing_user_count' as never).then(({ data }) => { const v = Number(data); if (Number.isFinite(v)) setUsers(v); }); }, []);
  const start = (where: string) => () => trackEvent('landing_v2_start', { where });

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-[#0f172a] dark:bg-[#1B1D21] dark:text-slate-100">
      <header className="sticky top-0 z-40 border-b border-gray-200/70 bg-white/85 backdrop-blur dark:border-white/10 dark:bg-[#1B1D21]/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link to="/" aria-label="ProfilePush"><Logo /></Link>
          <nav className="hidden items-center gap-5 text-[14px] font-semibold text-gray-600 dark:text-slate-300 md:flex">
            <a href="#how" className="hover:text-gray-900 dark:hover:text-white">How it works</a>
            <a href="#apply" className="hover:text-gray-900 dark:hover:text-white">Chrome extension</a>
            <a href="#pricing" className="hover:text-gray-900 dark:hover:text-white">Pricing</a>
          </nav>
          <span className="ml-auto flex items-center gap-2">
            <Link to="/signin" className="hidden h-9 items-center rounded-full px-3 text-[14px] font-semibold text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/5 sm:inline-flex">Sign in</Link>
            <Link to="/signup" onClick={start('header')} className="inline-flex h-9 items-center gap-1 rounded-full bg-[#2563EB] px-4 text-[14px] font-bold text-white hover:bg-blue-700">Start free<ChevronRight size={15} /></Link>
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-[#2563EB]/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 top-64 h-[360px] w-[360px] rounded-full bg-[#FACC15]/15 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 md:grid-cols-[1.1fr_1fr] md:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-gray-600 ring-1 ring-gray-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />{n(snap.stats.jobs24h)} new jobs in the last 24 hours
            </p>
            <h1 className="mt-5 text-balance text-[44px] font-extrabold leading-[1.04] tracking-tight sm:text-[60px]">
              Your best matches, <span className="text-[#2563EB]">every morning.</span>
            </h1>
            <p className="mt-5 max-w-[34rem] text-[18px] leading-relaxed text-gray-600 dark:text-slate-300">
              ProfilePush matches your profiles to fresh jobs, or your jobs to profiles, and plays them as a quick reel. Swipe, apply in a tap, and keep it all in one sheet.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/signup" onClick={start('hero')} className="inline-flex h-12 items-center gap-2 rounded-full bg-[#2563EB] px-6 text-[16px] font-bold text-white shadow-[0_10px_30px_rgba(37,99,235,.35)] hover:bg-blue-700">Start free: 100 matches<ArrowRight size={18} /></Link>
              <a href="#how" className="inline-flex h-12 items-center rounded-full px-5 text-[16px] font-bold text-gray-700 ring-1 ring-gray-300 hover:bg-white dark:text-slate-200 dark:ring-white/15 dark:hover:bg-white/5">See how it works</a>
            </div>
            {users != null && users > 0 && (
              <p className="mt-6 inline-flex items-center gap-2.5 text-[14.5px] font-semibold text-gray-700 dark:text-slate-200">
                <span className="flex -space-x-2" aria-hidden="true">
                  {['#2563EB', '#F97316', '#10b981', '#7c3aed'].map((c) => <span key={c} className="h-7 w-7 rounded-full border-2 border-[#f6f7fb] dark:border-[#1B1D21]" style={{ background: c }} />)}
                </span>
                Trusted by <b className="tabular-nums">{n(users)}</b> job posters and job seekers
              </p>
            )}
            <p className="mt-2 text-[13px] text-gray-500 dark:text-slate-400">No card needed</p>
          </div>
          <div className="relative mx-auto h-[560px] w-[330px] sm:w-[360px]">
            <img src="/landing-v2/data.webp" alt="" className="absolute left-6 top-6 h-[480px] w-[300px] rotate-[-7deg] rounded-[26px] object-cover opacity-70 shadow-xl" />
            <img src="/landing-v2/cloud.webp" alt="" className="absolute right-0 top-3 h-[480px] w-[300px] rotate-[6deg] rounded-[26px] object-cover opacity-80 shadow-xl" />
            <div className="absolute left-1/2 top-0 -translate-x-1/2"><ReelCard /></div>
          </div>
        </div>
      </section>

      {/* Live numbers */}
      <section className="border-y border-gray-200 bg-white dark:border-white/10 dark:bg-[#20242a]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 text-center md:grid-cols-4">
          {[[n(snap.stats.jobs30d), 'jobs posted in 30 days'], [n(snap.stats.hot30d), 'profiles on the bench'], ['10 min', 'between new matches'], ['24 h', 'to act on each one']].map(([v, l]) => (
            <div key={l}><b className="block text-[30px] font-extrabold tabular-nums tracking-tight">{v}</b><span className="text-[13.5px] text-gray-500 dark:text-slate-400">{l}</span></div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20">
        <h2 className="text-balance text-[34px] font-extrabold tracking-tight sm:text-[42px]">Three steps. Then it runs every day.</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Step n={1} title="Add a profile or a job" text="Paste a resume or a job post. We read the role, skills, visa, rate and location.">
            <div className="rounded-2xl bg-[#f6f7fb] p-3 text-[13px] dark:bg-white/5">
              <b className="block">Java Full Stack Developer</b>
              <span className="text-gray-500 dark:text-slate-400">9 years · H1B · Dallas, TX · $65/hr</span>
            </div>
          </Step>
          <Step n={2} title="Matches arrive all day" text="Each one plays for 15 seconds with its own picture and stays for 24 hours. Save the ones you want to keep.">
            <div className="flex gap-2">{['java', 'data', 'cloud'].map((p) => <img key={p} src={`/landing-v2/${p}.webp`} alt="" className="h-24 w-16 rounded-xl object-cover object-[50%_20%]" />)}</div>
          </Step>
          <Step n={3} title="Apply in a tap" text="By email from your own Gmail, or on the career site with ProfilePush Apply filling in the form. You press Apply.">
            <span className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#2563EB] px-4 text-[14px] font-bold text-white"><Send size={16} />Apply</span>
          </Step>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="grid gap-4 md:grid-cols-2">
          <Feature title="A picture for every match" text="Each job gets its own picture: its skills, its city. Turn on your avatar and the person in it is you.">
            <div className="flex items-end gap-3">
              <img src="/landing-v2/analyst.webp" alt="" className="h-40 w-28 rounded-2xl object-cover object-[50%_20%] shadow-lg" />
              <img src="/landing-v2/avatar.webp" alt="" className="h-32 w-24 rounded-2xl object-cover shadow-lg" />
            </div>
          </Feature>
          <Feature title="Your tracker is a sheet" text="Every application in one row, status and notes in the cell. Copy the rows straight into Google Sheets or Excel.">
            <div className="w-full max-w-sm overflow-hidden rounded-xl border border-gray-200 bg-white text-left text-[12px] dark:border-white/10 dark:bg-[#20242a]">
              {[['Job', 'Status'], ['Senior Java Developer', 'Interview'], ['Data Engineer', 'Replied'], ['Cloud Engineer', 'Applied']].map(([a, b], i) => (
                <div key={a} className={`grid grid-cols-[1fr_88px] border-b border-gray-100 last:border-0 dark:border-white/5 ${i === 0 ? 'bg-[#f8f9fa] font-semibold text-gray-500 dark:bg-white/5' : ''}`}>
                  <span className="border-r border-gray-100 px-2 py-1.5 dark:border-white/5">{a}</span><span className="px-2 py-1.5">{b}</span>
                </div>
              ))}
              <span className="flex items-center justify-end gap-1 px-2 py-1.5 text-[11.5px] font-semibold text-[#2563EB]"><Copy size={12} />Copy rows</span>
            </div>
          </Feature>
          <div id="apply" className="scroll-mt-16">
            <Feature title="ProfilePush Apply for Chrome" text="On a career site, it reads the application and fills it in for the profile you pick. You check it and press Apply.">
              <div className="w-full max-w-xs space-y-2 rounded-xl bg-white p-3 text-[12.5px] shadow-lg dark:bg-[#20242a]">
                {[['First name', 'Priya'], ['Authorized to work in the US?', 'Yes'], ['Years with Java', '9']].map(([l, v]) => (
                  <label key={l} className="block"><span className="text-gray-500 dark:text-slate-400">{l}</span>
                    <span className="mt-0.5 block rounded-md px-2 py-1 font-semibold outline outline-2 outline-emerald-500">{v}</span></label>
                ))}
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600"><MousePointerClick size={13} />Filled. Now press Apply.</span>
              </div>
            </Feature>
          </div>
          <Feature title="Ask the poster" text="A post without a rate, visa or location? One tap asks the poster for you, with your name on it.">
            <div className="flex flex-wrap justify-center gap-2">
              {[[DollarSign, 'Rate?'], [ShieldCheck, 'Visa?'], [MapPin, 'Location?']].map(([I, l]) => {
                const Icon = I as typeof MapPin;
                return <span key={l as string} className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 text-[14px] font-bold text-gray-700 dark:border-white/15 dark:bg-[#20242a] dark:text-slate-200"><Icon size={16} />{l as string}</span>;
              })}
              <span className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-emerald-50 px-4 text-[14px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Mail size={16} />Sent to the poster</span>
            </div>
          </Feature>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16 bg-[#0b1a3a] text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-2">
          <div>
            <h2 className="text-balance text-[34px] font-extrabold tracking-tight sm:text-[42px]">Pay only for matches.</h2>
            <p className="mt-3 max-w-md text-[16px] leading-relaxed text-white/75">No subscription. Viewing, applying, the tracker and the extension's form filling are free. Credits never expire.</p>
            <ul className="mt-6 space-y-2.5 text-[15px]">
              {['100 free matches to start', `Then ${price.perMatch} a match, any amount from ${price.minTopup}`, 'AI answers on career-site forms: 4 credits each', 'Paid in rupees in India, US dollars elsewhere'].map((t) => (
                <li key={t} className="flex items-center gap-2.5"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#FACC15] text-[#0b1a3a]"><Check size={12} strokeWidth={3} /></span>{t}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/10">
            <p className="text-[14px] font-semibold text-white/70">A match costs</p>
            <b className="block text-[56px] font-extrabold leading-none tracking-tight">{price.perMatch}</b>
            <p className="mt-2 text-[14px] text-white/70">{price.thousand} buys 1,000 matches.</p>
            <Link to="/signup" onClick={start('pricing')} className="mt-6 flex h-12 items-center justify-center gap-2 rounded-full bg-[#2563EB] text-[16px] font-bold hover:bg-blue-500">Start free<ArrowRight size={18} /></Link>
            <p className="mt-4 flex items-center gap-2 text-[13.5px] text-white/75"><Gift size={16} className="shrink-0 text-[#FACC15]" />Invite a friend: you get 100 credits, they get 50 extra.</p>
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="mx-auto max-w-6xl px-4 py-20 text-center">
        <Sparkles size={28} className="mx-auto text-[#F97316]" />
        <h2 className="mx-auto mt-3 max-w-2xl text-balance text-[34px] font-extrabold tracking-tight sm:text-[42px]">Tomorrow morning, your first matches are waiting.</h2>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/signup" onClick={start('closing')} className="inline-flex h-12 items-center gap-2 rounded-full bg-[#2563EB] px-6 text-[16px] font-bold text-white hover:bg-blue-700">Start free: 100 matches<ArrowRight size={18} /></Link>
          <a href="https://play.google.com/store/apps/details?id=com.profilepush.app" target="_blank" rel="noreferrer" className="inline-flex h-12 items-center gap-2 rounded-full px-5 text-[16px] font-bold ring-1 ring-gray-300 hover:bg-white dark:ring-white/15 dark:hover:bg-white/5"><ExternalLink size={16} />Get the Android app</a>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
