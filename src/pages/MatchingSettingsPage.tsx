import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Check, ChevronRight, CreditCard, Lock, Mail, Smartphone, UserCog, Users } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import { Initials } from '../components/match/Visuals';
import AvatarPanel from '../components/match/AvatarPanel';
import { PLAIN_SCORE_KEY, plainScore } from '../lib/prefs';
import ReferPanel from '../components/ReferPanel';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { enableWebPush } from '../lib/onesignal';
import { trackEvent } from '../lib/track';
import { priceLabels, useCurrency } from '../lib/currency';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';
const MIN_OPTIONS = [50, 55, 60, 65, 70, 75, 80];
const CAP_OPTIONS = [10, 20, 30, 50, 75, 100];

type Subject = { subject_id: string; kind: 'hotlist' | 'job'; title: string; cap: number; today: number };

function Section({ title, detail, children, badge }: { title: string; detail: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-[#20242a]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white">{title}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-gray-500 dark:text-slate-400">{detail}</p>
        </div>
        {badge}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

// Settings, in two columns on desktop: their own settings (account, alerts,
// avatar, referrals, display) and matching (on/off, minimum match, daily
// matches per profile or job). Phones show matching first.
export default function MatchingSettingsPage() {
  const [plain, setPlain] = useState(plainScore);
  const [currencyNow] = useCurrency();
  const price = priceLabels(currencyNow);
  const { account } = useAuth();
  const navigate = useNavigate();
  const native = Capacitor.isNativePlatform();
  const [gmail, setGmail] = useState<string | null>(null);
  useEffect(() => {
    void supabase.from('gmail_integration_status' as never).select('status, gmail_address' as never).maybeSingle()
      .then(({ data }: { data: { status?: string; gmail_address?: string } | null }) => setGmail(data?.status === 'connected' ? (data.gmail_address || 'connected') : ''));
  }, []);
  const connectGmail = async () => {
    if (!account?.id) return;
    const { data, error } = await supabase.functions.invoke('gmail-oauth-start', { body: { account_id: account.id, return_to: '/settings', return_origin: window.location.origin } });
    if (!error && data?.url) window.location.href = data.url;
  };
  const [loading, setLoading] = useState(true);
  const [autoMatch, setAutoMatch] = useState(true);
  const [minMatch, setMinMatch] = useState(70);
  const [paid, setPaid] = useState(false);
  const [defaultCap, setDefaultCap] = useState(10);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [saved, setSaved] = useState('');
  const [pushState, setPushState] = useState<NotificationPermission | 'unsupported'>(() => (
    typeof window !== 'undefined' && 'Notification' in window && !native ? Notification.permission : 'unsupported'
  ));

  const load = useCallback(async () => {
    if (!account?.id) return;
    const [acct, caps] = await Promise.all([
      supabase.from('accounts').select('auto_match_enabled, match_min_score' as never).eq('id', account.id).maybeSingle(),
      supabase.rpc('get_match_caps' as never),
    ]);
    const a = acct.data as { auto_match_enabled?: boolean; match_min_score?: number } | null;
    if (a) { setAutoMatch(a.auto_match_enabled !== false); setMinMatch(a.match_min_score ?? 70); }
    const c = caps.data as { paid?: boolean; default_cap?: number; subjects?: Subject[] } | null;
    setPaid(Boolean(c?.paid));
    setDefaultCap(Number(c?.default_cap ?? 10));
    setSubjects(c?.subjects ?? []);
    setLoading(false);
  }, [account?.id]);

  useEffect(() => { void load(); }, [load]);
  // /settings#avatar (from Today) lands on the avatar card.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!loading && (hash === 'avatar' || hash === 'refer')) document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading]);

  const flash = (msg: string) => { setSaved(msg); window.setTimeout(() => setSaved(''), 2500); };

  const toggleAuto = async () => {
    const next = !autoMatch;
    setAutoMatch(next);
    trackEvent('tracker_auto_match_toggled', { enabled: next, from: 'settings' });
    const { error } = await supabase.rpc('set_auto_match' as never, { p_enabled: next } as never);
    if (error) setAutoMatch(!next); else flash(next ? 'AI Matches are on' : 'AI Matches are off');
  };
  const changeMin = async (v: number) => {
    if (!paid) return;
    setMinMatch(v);
    trackEvent('min_match_changed', { value: v, from: 'settings' });
    const { error } = await supabase.rpc('set_match_min_score' as never, { p_score: v } as never);
    if (!error) flash(`Minimum match set to ${v}%`);
  };
  const changeCap = async (subjectId: string, cap: number) => {
    if (!paid) return;
    setSubjects((list) => list.map((s) => (s.subject_id === subjectId ? { ...s, cap } : s)));
    trackEvent('tracker_daily_cap_changed', { cap, from: 'settings' });
    const { error } = await supabase.rpc('set_subject_match_cap' as never, { p_subject_id: subjectId, p_cap: cap } as never);
    if (!error) flash(`Daily limit set to ${cap}`);
  };

  const lockBadge = !paid && (
    <Link to="/billing" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11.5px] font-semibold text-amber-800 hover:bg-amber-200">
      <Lock size={11} />Paid
    </Link>
  );
  const balance = Math.floor(Number(account?.credits_balance ?? 0));

  return (
    <div className="min-h-[100dvh] bg-[#f3f2ee] pb-[calc(5rem+env(safe-area-inset-bottom))] text-gray-900 dark:bg-[#1B1D21] dark:text-slate-100 sm:pb-10">
      <AppNav />
      <main className="mx-auto w-full max-w-6xl space-y-2.5 px-3 pt-3 sm:px-4">
        {saved && (
          <span role="status" className="fixed left-1/2 top-16 z-40 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-lg">
            <Check size={14} />{saved}
          </span>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><LogoSpinner size={20} /></div>
        ) : (
          <div className="grid items-start gap-2.5 lg:grid-cols-2 lg:gap-3">
            {/* Your settings. */}
            <div className="order-2 space-y-2.5 lg:order-1">
              <Section title="Account" detail="Where applications go from, your plan and your team.">
                <ul className="divide-y divide-gray-100 dark:divide-white/10">
                  <li className="flex items-center gap-3 py-2.5">
                    <Mail size={18} className="shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1"><p className="text-[13.5px] font-semibold">Gmail</p><p className="truncate text-[12px] text-gray-500 dark:text-slate-400">{gmail ? `Applications go from ${gmail === 'connected' ? 'your Gmail' : gmail}` : 'Connect it to apply by email'}</p></div>
                    {gmail ? <span className="inline-flex items-center gap-1 text-[13px] font-bold text-emerald-600"><Check size={14} />Connected</span>
                      : gmail === '' ? <button type="button" onClick={() => void connectGmail()} className="h-9 rounded-lg bg-blue-600 px-3 text-[13px] font-semibold text-white">Connect</button> : null}
                  </li>
                  {[
                    { to: '/billing', icon: CreditCard, title: `${balance.toLocaleString('en-IN')} matches left`, detail: `${price.perMatch} a match · top up from ${price.minTopup}` },
                    { to: '/team', icon: Users, title: 'Team', detail: 'What each recruiter applied to' },
                    { to: '/account', icon: UserCog, title: 'Account', detail: 'Profile, company, password' },
                  ].map((row) => (
                    <li key={row.to}>
                      <Link to={row.to} className="flex items-center gap-3 py-2.5">
                        <row.icon size={18} className="shrink-0 text-gray-400" />
                        <div className="min-w-0 flex-1"><p className="text-[13.5px] font-semibold">{row.title}</p><p className="text-[12px] text-gray-500 dark:text-slate-400">{row.detail}</p></div>
                        <ChevronRight size={16} className="text-gray-400" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title="Match alerts" detail="Hear about a strong match the moment it lands.">
                <div className="flex flex-wrap gap-2">
                  {pushState === 'granted' ? (
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-[13px] font-semibold text-emerald-700"><Check size={14} />Browser alerts on</span>
                  ) : pushState === 'default' ? (
                    <button type="button" onClick={() => { void enableWebPush().then(setPushState); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-semibold hover:bg-gray-50 dark:border-white/15 dark:bg-white/5">
                      <Bell size={14} />Turn on browser alerts
                    </button>
                  ) : pushState === 'denied' ? (
                    <span className="text-[12.5px] text-gray-500">Browser alerts are blocked. Allow notifications for profilepush.ai in your browser settings.</span>
                  ) : null}
                  {!native && (
                    <a href={PLAY_URL} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[13px] font-semibold text-white hover:bg-gray-800">
                      <Smartphone size={14} />Get the Android app
                    </a>
                  )}
                </div>
              </Section>
              <div id="avatar" className="scroll-mt-20">
                <Section title="Your avatar" detail="See yourself in your job matches, holding each job's skills. Free to make. It shows while you have matches left.">
                  <AvatarPanel />
                </Section>
              </div>
              <div id="refer" className="scroll-mt-20">
                <Section title="Refer and earn" detail="Share your link. When someone signs up with it, you get 100 credits and they get 50 bonus credits on top of their 100.">
                  <ReferPanel />
                </Section>
              </div>
              <Section title="Match score" detail={plain ? 'Shown as it is.' : 'Swings a moment before it lands on the score. Tap Show score on any card to skip it.'}
                badge={(
                  <button type="button" role="switch" aria-checked={!plain} onClick={() => { const next = !plain; try { if (next) localStorage.setItem(PLAIN_SCORE_KEY, '1'); else localStorage.removeItem(PLAIN_SCORE_KEY); } catch { /* fine */ } setPlain(next); }}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${!plain ? 'bg-green-600' : 'bg-gray-300 dark:bg-white/20'}`}>
                    <span className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform ${!plain ? 'translate-x-6' : 'translate-x-1'}`} />
                    <span className="sr-only">Animate the match score</span>
                  </button>
                )}
              >{null}</Section>
            </div>
            {/* Matches and profiles (first on phones). */}
            <div className="order-1 space-y-2.5 lg:order-2">
              <Section
                title="AI Matches"
                detail={autoMatch ? 'On: new matches arrive all day and you get alerts.' : 'Off: no new matches and no match alerts. Your existing matches stay.'}
                badge={(
                  <button type="button" role="switch" aria-checked={autoMatch} onClick={() => void toggleAuto()}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${autoMatch ? 'bg-green-600' : 'bg-gray-300 dark:bg-white/20'}`}>
                    <span className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform ${autoMatch ? 'translate-x-6' : 'translate-x-1'}`} />
                    <span className="sr-only">AI Matches</span>
                  </button>
                )}
              >
                <p className="text-[12.5px] text-gray-500 dark:text-slate-400">
                  <b className="tabular-nums text-gray-900 dark:text-white">{balance.toLocaleString('en-IN')}</b> matches left · 1 match = {price.perMatch} ·{' '}
                  <Link to="/billing" className="font-semibold text-blue-600 hover:underline">Top up</Link>
                </p>
              </Section>
              <Section
                title="Minimum match"
                detail={paid ? 'New matches must reach this score. Lower for more matches, higher for fewer, stronger ones.' : `Free accounts match at 70%. Any top-up from ${price.minTopup} lets you choose 50–80%.`}
                badge={lockBadge}
              >
                <div className="grid grid-cols-7 gap-1.5" role="radiogroup" aria-label="Minimum match">
                  {MIN_OPTIONS.map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={minMatch === v} disabled={!paid} onClick={() => void changeMin(v)}
                      className={`h-10 rounded-lg text-[13.5px] font-bold tabular-nums transition-colors disabled:cursor-not-allowed ${minMatch === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:hover:bg-gray-100 dark:bg-white/5 dark:text-slate-200'}`}>
                      {v}%
                    </button>
                  ))}
                </div>
              </Section>
              <Section
                title="Daily matches"
                detail={paid ? `Most new matches each one can get in a day. ${defaultCap} unless you change it.` : 'Free accounts get 10 new matches a day in all. Paid accounts choose up to 100 for each.'}
                badge={lockBadge}
              >
                {subjects.length === 0 ? (
                  <p className="text-[13px] text-gray-500">Nothing posted yet. <Link to="/today" className="font-semibold text-blue-600 hover:underline">Add a profile or job</Link>.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-white/10">
                    {subjects.map((s) => (
                      <li key={s.subject_id} className="flex items-center gap-3 py-2.5">
                        <button type="button" onClick={() => navigate(`/today?profile=${s.subject_id}`)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" title="Open">
                          <Initials name={s.title} id={s.subject_id} size={32} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-semibold">{s.title}</span>
                            <span className="block text-[12px] tabular-nums text-gray-500 dark:text-slate-400">
                              {s.kind === 'hotlist' ? 'Profile' : 'Job'} · today {Math.min(s.today, s.cap)} of {s.cap}
                            </span>
                          </span>
                        </button>
                        {paid ? (
                          <select value={s.cap} onChange={(e) => void changeCap(s.subject_id, Number(e.target.value))} aria-label={`Daily matches for ${s.title}`}
                            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[13px] font-semibold dark:border-white/10 dark:bg-white/5">
                            {[...new Set([...CAP_OPTIONS, s.cap])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v} a day</option>)}
                          </select>
                        ) : (
                          <span className="text-[13px] font-semibold tabular-nums text-gray-500">10 a day</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
