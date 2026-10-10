import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CreditCard, Zap, ChevronDown, BarChart2,
  ChevronLeft, ChevronRight, Check, X,
  ArrowUpRight, ArrowDownRight, AlertCircle, RefreshCw,
  TrendingUp, TrendingDown, Activity, Layers, Clock,
  Search, Brain, FileText, Sparkles, Target, Users,
  Info, LayoutGrid, List, Cpu,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import { buildSupabaseFunctionHeaders, supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import LogoSpinner from '../components/LogoSpinner';
import { getBillingErrorMessage, openRazorpayCheckout } from '../lib/billing-plan';
import { fetchFirstPurchaseOffer, formatCountdown, useOfferCountdown } from '../lib/first-purchase-offer';

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void };
  }
}

const MARKUP = 4;
const PAGE_SIZE = 15;
// Top-ups are any whole-rupee amount at ₹0.25 a match: 1 credit = 1 match,
// 4 to the rupee (razorpay-create-credit-order). The dialog offers a few
// amounts and takes any other from ₹100.
const CREDITS_PER_RUPEE = 4;
const QUICK_AMOUNTS = [250, 500, 1000, 2500, 5000];
const MIN_TOPUP_INR = 100;
const MAX_TOPUP_INR = 100000;
const DEFAULT_CREDIT_PACK = 250;

// What deducts credits: one thing, a match. A new match on the Tracker or
// Today costs 1 credit (charge_tracker_match trigger), and so does each new
// AI Match result (ai-match). Everything else is free: opening posts,
// drafts, sends from Gmail (the *_COST constants in ask-ai-vendor-email,
// send-vendor-message, submit-consultant, generate-chat-message are 0),
// video screenings and Apply. "Not a match" refunds a paid match, up to 20%.
// Milestone grants (grant_milestone_credits, awarded by trigger). Listed here
// so the app can show what is still unearned — an incentive nobody is told
// about changes nobody's behaviour.
const CREDIT_MILESTONES: { key: string; label: string; amount: number; hint: string }[] = [
  { key: 'first_post', label: 'Publish your first post', amount: 10, hint: 'A consultant or a job of your own — worth one AI Match run' },
  { key: 'first_submission', label: 'Send your first submission', amount: 10, hint: 'Submit a consultant to any job' },
];

const CREDIT_COST_ITEMS: { label: string; cost: string; short: string; note?: string }[] = [
  {
    label: 'A match',
    cost: '1 credit',
    short: '1 credit = 1 match, ₹0.25',
    note: 'Each new match for your consultants or requirements on the Tracker and Today, and each new AI Match result. A job you already paid for is never charged again, and reposts of the same requirement are merged. Free accounts get up to 10 new matches per consultant a day; paid accounts 30 by default, up to 100, set per consultant on the Tracker. Turn AI Matches off on the Tracker to pause them.',
  },
  {
    label: '“Not a match”',
    cost: 'Refunded',
    short: 'Mark a match “Not a match” and get the credit back',
    note: 'Up to 20% of your matches in the last 30 days.',
  },
  {
    label: 'Everything else',
    cost: 'Free',
    short: 'Everything else is free: opening jobs, AI Submit, bulk send, Apply',
    note: 'Opening job posts, AI Submit and AI Request drafts and sends from your Gmail, bulk send, Inbox replies, video screenings and applying on career sites.',
  },
  {
    label: 'Out of credits',
    cost: 'Matches wait',
    short: 'Out of credits? New matches wait until you top up',
    note: 'They are still found and saved, best first, and appear as soon as you add credits.',
  },
];

interface UsageRow {
  id: string;
  user_id: string | null;
  account_id: string | null;
  function_name: string;
  provider: string;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const TIMEFRAMES = [
  { label: 'Last 7 days',  days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'All time',     days: 0 },
];

const FN_LABELS: Record<string, string> = {
  'ai-match':              'AI Match',
  'parse-resume':          'Resume Parse',
  'score-job-match':       'Job Match Score',
  'radar-match':           'Job Watch AI',
  'rewrite-resume':        'Resume Rewrite',
  'rewrite-field':         'Field Rewrite',
  'generate-search-ideas': 'Search Ideas',
  'dashboard-summary':     'Dashboard AI',
  'dashboard-ai-insights': 'Dashboard AI Insights',
  'linkedin-search':       'LinkedIn Search',
  'dice-search':           'Dice Search',
  'indeed-search':         'Indeed Search',
  'monster-search':        'Monster Search',
  'careerbuilder-search':  'CareerBuilder Search',
  'suggest-priority-skills': 'Skill Suggestions',
};

type CategoryKey = 'AI Rewrite' | 'AI Match' | 'AI Extract' | 'AI Ideas' | 'AI Insights' | 'AI Skills' | 'Search';
const CAT_COLORS: Record<CategoryKey, string> = {
  'AI Rewrite':   '#3b82f6',
  'AI Match':     '#10b981',
  'AI Extract':   '#8b5cf6',
  'AI Ideas':     '#f59e0b',
  'AI Insights':  '#0ea5e9',
  'AI Skills':    '#ec4899',
  'Search':       '#64748b',
};

function fnCategory(fn: string): CategoryKey {
  if (fn.includes('rewrite'))  return 'AI Rewrite';
  // 'ai-match' has to be named: without it the fall-through files the app's
  // most-used AI feature under Search.
  if (fn.includes('match') || fn.includes('score') || fn.includes('radar'))    return 'AI Match';
  if (fn.includes('parse'))    return 'AI Extract';
  if (fn.includes('ideas'))    return 'AI Ideas';
  if (fn.includes('summary') || fn.includes('insights'))  return 'AI Insights';
  if (fn.includes('skill'))    return 'AI Skills';
  return 'Search';
}
function fnIcon(fn: string) {
  if (fn.includes('rewrite'))  return FileText;
  if (fn.includes('match') || fn.includes('score'))    return Target;
  if (fn.includes('parse'))    return Layers;
  if (fn.includes('ideas'))    return Sparkles;
  if (fn.includes('summary') || fn.includes('insights'))  return Brain;
  if (fn.includes('skill'))    return Activity;
  return Search;
}

function fmtCredits(n: number) { return `$${Math.max(0, n).toFixed(4)}`; }
function fmtBalance(n: number) { return `${Math.floor(Math.max(0, n)).toLocaleString('en-IN')} credits`; }
function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Mini donut chart ────────────────────────────────────────────────────────
interface DonutSeg { value: number; color: string }
function MiniDonut({ segs, size = 64 }: { segs: DonutSeg[]; size?: number }) {
  const r = (size - 10) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (total === 0) return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={8} />
    </svg>
  );
  let cum = 0;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      {segs.map((s, i) => {
        const pct = s.value / total;
        const dash = circ * pct;
        const gap  = circ - dash;
        const offset = circ - circ * (cum / total);
        cum += s.value;
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth={8}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#3b82f6', height = 32 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return <div style={{ height }} />;
  const w = 120, h = height;
  const max = Math.max(...data, 0.001);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Insight chip ─────────────────────────────────────────────────────────────
function Insight({ icon: Icon, text, accent }: { icon: React.FC<{ size: number; className?: string }>; text: string; accent: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border" style={{ borderColor: `${accent}30`, backgroundColor: `${accent}08` }}>
      <Icon size={12} className="mt-0.5 shrink-0" style={{ color: accent }} />
      <p className="text-[12px] leading-tight" style={{ color: accent }}>{text}</p>
    </div>
  );
}

// ── Tooltip ─────────────────────────────────────────────────────────────────
function Tip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <Info size={11} className="text-gray-300 cursor-help" />
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 text-center bg-gray-900 text-white text-[11px] leading-tight rounded-lg px-2.5 py-2 z-50 shadow-xl pointer-events-none">
          {text}
        </span>
      )}
    </span>
  );
}

export default function BillingPage() {
  const { account, user, refreshAccount } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const autoOpenPlanRef = useRef(false);

  const [usageLogs, setUsageLogs] = useState<UsageRow[]>([]);
  const [earnedMilestones, setEarnedMilestones] = useState<Set<string>>(new Set());
  const [visibleBalance, setVisibleBalance] = useState<number | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading]     = useState(true);
  const [timeframe, setTimeframe] = useState(30);
  const [activeTab, setActiveTab] = useState<'team' | 'visual' | 'log'>('team');
  const [logView, setLogView]     = useState<'table' | 'cards'>('table');
  const [page, setPage]           = useState(1);
  const [filterFn, setFilterFn]   = useState<string>('');

  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false);
  const [selectedCreditTier, setSelectedCreditTier]   = useState<number>(DEFAULT_CREDIT_PACK);
  const [buyingCredits, setBuyingCredits]             = useState(false);
  // Shown after a top-up: confirmed (credits added) or still confirming.
  const [purchaseResult, setPurchaseResult] = useState<{ credits: number; balance: number | null; paymentId: string; confirmed: boolean } | null>(null);
  // First-purchase offer (double credits for an hour), if this account has one live.
  const [offerExpiresAt, setOfferExpiresAt] = useState<Date | null>(null);
  const offerSecondsLeft = useOfferCountdown(offerExpiresAt);
  const offerLive = offerExpiresAt !== null && offerSecondsLeft > 0;
  const [purchases, setPurchases] = useState<Array<{ razorpay_order_id: string; razorpay_payment_id: string | null; credits: number; amount_inr_paise: number; created_at: string; paid_at: string | null }>>([]);

  const loadPurchases = useCallback(async () => {
    const { data } = await supabase.rpc('get_my_credit_purchases' as never);
    setPurchases(((data ?? []) as unknown) as typeof purchases);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void loadPurchases(); }, [loadPurchases]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);


  const showToast = (message: string, type: 'success' | 'error') => setToast({ message, type });

  const load = useCallback(async () => {
    const accountId = account?.id;
    if (!accountId) return;
    setLoading(true);
    const since = timeframe > 0 ? new Date(Date.now() - timeframe * 86_400_000).toISOString() : null;
    const q = supabase.from('api_usage_log').select('*').eq('account_id', accountId).order('created_at', { ascending: false });
    if (since) q.gte('created_at', since);
    const [{ data }, { data: members }, { data: balanceRow }, { data: milestoneRows }] = await Promise.all([
      q,
      supabase.from('account_members').select('user_id, display_name, invited_email').eq('account_id', accountId),
      supabase.from('accounts').select('credits_balance').eq('id', accountId).maybeSingle(),
      supabase.rpc('get_earned_milestones' as never),
    ]);
    setEarnedMilestones(new Set(((milestoneRows ?? []) as { milestone_key: string }[]).map((row) => row.milestone_key)));
    setUsageLogs(data ?? []);
    setVisibleBalance(Number(balanceRow?.credits_balance ?? account?.credits_balance ?? 0));
    const names: Record<string, string> = {};
    for (const m of members ?? []) {
      if (m.user_id) names[m.user_id] = m.display_name || m.invited_email || 'Unknown';
    }
    setUserNames(names);
    setPage(1);
    setLoading(false);
  }, [account?.id, timeframe]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!account?.id) return;
    let cancelled = false;
    void fetchFirstPurchaseOffer(account.id).then((date) => { if (!cancelled) setOfferExpiresAt(date); });
    return () => { cancelled = true; };
  }, [account?.id]);

  useEffect(() => {
    if (autoOpenPlanRef.current) return;
    const params = new URLSearchParams(location.search);
    if (params.get('openPlan') !== '1') return;

    autoOpenPlanRef.current = true;
    setShowBuyCreditsModal(true);
    params.delete('openPlan');
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : '',
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (typeof account?.credits_balance === 'number') {
      setVisibleBalance(account.credits_balance);
    }
  }, [account?.credits_balance]);

  const balance = visibleBalance ?? account?.credits_balance ?? 0;
  const totalUsersInAccount = Object.keys(userNames).length + (account?.owner_id ? 1 : 0);

  function fireCrmEvent(event: string, extra: Record<string, unknown> = {}) {
    supabase.functions.invoke('notify-crm-webhook', {
      body: {
        event, account_id: account?.id ?? null, user_id: user?.id ?? null,
        email: user?.email ?? null,
        phone: user?.phone ?? user?.user_metadata?.phone ?? null,
        name: user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? null,
        credits_balance: account?.credits_balance ?? null,
        owner_id: account?.owner_id ?? null,
        ...extra,
      },
    }).catch(() => {});
  }

  function openBuyCreditsModal() {
    setSelectedCreditTier(DEFAULT_CREDIT_PACK);
    fireCrmEvent('billing.buy_credits_button_clicked', { current_balance: balance });
    setShowBuyCreditsModal(true);
  }

  // ── Analytics computations ─────────────────────────────────────────────────
  const { breakdown, totalOps, insights, dailySeries, donutSegs } = useMemo(() => {
    const byFn: Record<string, { count: number; cost: number; tokens: number }> = {};
    const byCat: Record<string, { count: number; cost: number }> = {};
    const byDay: Record<string, number> = {};
    let totalCost = 0, totalOps = 0, totalTok = 0;

    for (const row of usageLogs) {
      const fn  = row.function_name;
      const cat = fnCategory(fn);
      const cost = (row.cost_usd ?? 0) * MARKUP;
      const tok  = row.total_tokens ?? 0;
      totalCost += cost;
      totalOps++;
      totalTok += tok;
      if (!byFn[fn]) byFn[fn] = { count: 0, cost: 0, tokens: 0 };
      byFn[fn].count++;
      byFn[fn].cost  += cost;
      byFn[fn].tokens += tok;
      if (!byCat[cat]) byCat[cat] = { count: 0, cost: 0 };
      byCat[cat].count++;
      byCat[cat].cost += cost;
      const day = row.created_at.slice(0, 10);
      byDay[day] = (byDay[day] ?? 0) + cost;
    }

    const breakdown = Object.entries(byFn)
      .map(([fn, v]) => ({ fn, ...v }))
      .sort((a, b) => b.cost - a.cost);

    // Daily series (sorted ascending)
    const sortedDays = Object.keys(byDay).sort();
    const dailySeries = sortedDays.map(d => byDay[d]);

    // Donut segments by category
    const donutSegs = Object.entries(byCat).map(([cat, v]) => ({
      label: cat, value: v.cost, color: CAT_COLORS[cat as CategoryKey] ?? '#94a3b8',
    }));

    // Intelligence insights
    const insights: string[] = [];
    const topFn = breakdown[0];
    if (topFn) {
      insights.push(`${FN_LABELS[topFn.fn] ?? topFn.fn} accounts for ${((topFn.cost / totalCost) * 100).toFixed(0)}% of spend — your highest-value operation.`);
    }
    const aiCost  = Object.entries(byCat).filter(([k]) => k !== 'Search').reduce((s, [, v]) => s + v.cost, 0);
    const srchCost = byCat['Search']?.cost ?? 0;
    if (aiCost > 0 && srchCost > 0) {
      const aiPct = (aiCost / totalCost * 100).toFixed(0);
      insights.push(`${aiPct}% AI vs ${(100 - Number(aiPct)).toFixed(0)}% Search — ${Number(aiPct) > 70 ? 'AI-heavy usage, good signal of deep processing.' : 'Search-heavy usage, consider higher match scoring for better ROI.'}`);
    }
    const avgCostPerOp = totalOps > 0 ? totalCost / totalOps : 0;
    if (avgCostPerOp > 0) {
      insights.push(`Average ${fmtCredits(avgCostPerOp)} per operation across ${totalOps} runs — ${avgCostPerOp < 0.01 ? 'very efficient' : avgCostPerOp < 0.05 ? 'moderate cost' : 'consider batch processing'}.`);
    }
    if (totalTok > 0) {
      insights.push(`${fmtK(totalTok)} total tokens processed. Avg ${Math.round(totalTok / Math.max(totalOps, 1))} tokens per call.`);
    }
    return { breakdown, totalCost, totalOps, insights, dailySeries, donutSegs };
  }, [usageLogs]);

  // Filtered + paged logs
  const filteredLogs = useMemo(() =>
    filterFn ? usageLogs.filter(r => r.function_name === filterFn) : usageLogs,
    [usageLogs, filterFn]
  );
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const pagedLogs  = filteredLogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const uniqueFns  = [...new Set(usageLogs.map(r => r.function_name))].sort();

  async function handleBuyCredits() {
    setBuyingCredits(true);
    try {
      const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
      const { data, error } = await supabase.functions.invoke('razorpay-create-credit-order', {
        body: { amount_inr: selectedCreditTier },
        headers,
      });
      if (error) {
        let msg = 'Failed to start checkout';
        try { const body = await (error as { context?: Response }).context?.json?.(); if (body?.error) msg = body.error; } catch {}
        throw new Error(msg);
      }
      if (!data?.order_id) {
        throw new Error(data?.error ?? 'Failed to start checkout');
      }
      await openRazorpayCheckout({
        key: data.key_id, order_id: data.order_id, amount: data.amount_inr_paise, currency: 'INR',
        name: 'ProfilePush',
        description: `${(selectedCreditTier * CREDITS_PER_RUPEE).toLocaleString('en-IN')} matches`,
        image: '/favicon.svg',
        handler: async (response: Record<string, unknown>) => {
          fireCrmEvent('credits.topup_payment_success', {
            credits: selectedCreditTier * CREDITS_PER_RUPEE,
            amount_inr: selectedCreditTier,
            razorpay_order_id: data.order_id,
            razorpay_payment_id: response.razorpay_payment_id ?? null,
          });
          setShowBuyCreditsModal(false);
          const paymentId = String(response.razorpay_payment_id ?? '');
          // Confirm with us right away (signature-checked) so the credits land
          // now; the webhook would credit it too, but only once either way.
          let confirmed = false;
          let balance: number | null = null;
          try {
            const verifyHeaders = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
            const { data: verified, error: verifyError } = await supabase.functions.invoke('razorpay-verify-credit-payment', {
              body: {
                razorpay_order_id: response.razorpay_order_id ?? data.order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
              headers: verifyHeaders as Record<string, string>,
            });
            if (!verifyError && verified && !verified.error) {
              confirmed = true;
              balance = typeof verified.balance === 'number' ? verified.balance : Number(verified.balance ?? NaN);
              if (!Number.isFinite(balance)) balance = null;
            }
          } catch {
            // Falls back to the webhook; the result screen says so.
          }
          // The order knows whether the first-purchase bonus applied.
          const added = selectedCreditTier * CREDITS_PER_RUPEE + Number(data.bonus_credits ?? 0);
          setPurchaseResult({ credits: added, balance, paymentId, confirmed });
          if (Number(data.bonus_credits ?? 0) > 0 && account?.id) {
            setOfferExpiresAt(null);
            void fetchFirstPurchaseOffer(account.id, true);
          }
          setBuyingCredits(false);
          await refreshAccount();
          void loadPurchases();
        },
        prefill: { name: user?.user_metadata?.full_name ?? '', email: user?.email ?? '' },
        theme: { color: '#2563eb' },
        onDismiss: () => { fireCrmEvent('credits.topup_checkout_dismissed', { credits: selectedCreditTier }); setBuyingCredits(false); },
      });
    } catch (err) {
      const msg = getBillingErrorMessage(err, 'Failed to start checkout');
      fireCrmEvent('credits.topup_checkout_failed', { credits: selectedCreditTier, error: msg });
      showToast(msg, 'error');
      setBuyingCredits(false);
    }
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-50 overscroll-none pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Header */}
        <div className="px-3 sm:px-6 py-3 border-b border-gray-200 bg-white shrink-0">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
                <CreditCard size={15} className="text-blue-600" />
              </div>
              <div>
                <h1 className="text-[15px] font-bold text-gray-900">Billing & Credits</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Timeframe selector */}
              <div className="relative">
                <select value={timeframe} onChange={e => { setTimeframe(Number(e.target.value)); setPage(1); }}
                  className="appearance-none text-[13px] font-medium text-gray-600 bg-white border border-gray-200 rounded-xl pl-3 pr-7 py-2 focus:outline-none focus:border-blue-400 cursor-pointer">
                  {TIMEFRAMES.map(t => <option key={t.days} value={t.days}>{t.label}</option>)}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              {!window.matchMedia('(max-width: 639px)').matches && (
                <button onClick={openBuyCreditsModal}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold text-white shadow-sm hover:opacity-90 transition-opacity"
                  style={{ background: 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)' }}>
                  <ArrowUpRight size={13} />
                  Buy credits
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-5 flex flex-col lg:flex-row gap-4 sm:gap-5">

            {/* ── LEFT: Summary ─────────────────────────────── */}
            <div className="flex-1 flex flex-col gap-4 min-w-0">

              {/* 2-card pricing: Free vs credit packs (no subscription) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-gray-200 bg-white p-5 flex flex-col">
                  <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3 bg-yellow-100 text-yellow-700 w-fit">Free</span>
                  <p className="text-2xl font-extrabold text-gray-900">₹0<span className="text-[15px] font-semibold text-gray-500">/mo</span></p>
                  <p className="text-[13px] text-gray-500 mt-0.5 mb-4">100 free matches · never expire · no card required</p>
                  <ul className="space-y-2 text-[13px] text-gray-600 flex-1 mb-4">
                    {['Feed, Today, Tracker, AI Match and Inbox', 'Opening jobs, AI Submit, bulk send and Apply are free', 'Unlimited team members', '10 new matches a day per consultant, 70% minimum match'].map(item => (
                      <li key={item} className="flex items-start gap-2">
                        <Check size={12} className="mt-0.5 shrink-0 text-emerald-600" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <button onClick={openBuyCreditsModal} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-[13px] font-bold text-gray-700 transition hover:bg-gray-50">
                    Buy more credits
                  </button>
                </div>

                <div className="rounded-2xl p-5 flex flex-col relative" style={{ background: 'linear-gradient(145deg, #1d4ed8 0%, #2563eb 60%, #1e40af 100%)' }}>
                  <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3 bg-white/15 text-white w-fit">Pay per match</span>
                  <p className="text-2xl font-extrabold text-white">₹0.25<span className="text-[15px] font-semibold text-blue-200"> a match</span></p>
                  <p className="text-[13px] text-blue-200 mt-0.5 mb-4">Any amount from ₹100 · never expire · no subscription</p>
                  <ul className="space-y-2 text-[13px] text-white flex-1 mb-4">
                    {['₹250 = 1,000 matches', 'Up to 100 matches a day per consultant (free: 10)', 'Choose your minimum match, 50–80% (free: 70%)', 'Unlimited open consultants or requirements', 'Only matches cost credits; everything else is free'].map(item => (
                      <li key={item} className="flex items-start gap-2">
                        <Check size={12} className="mt-0.5 shrink-0 text-white" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <button onClick={openBuyCreditsModal} className="w-full rounded-xl bg-white px-4 py-2.5 text-[13px] font-bold text-blue-700 transition hover:bg-blue-50">
                    Buy credits
                  </button>
                </div>
              </div>

              {/* The one setting that controls spend: how strong a match must be. */}
              <MinMatchSetting accountId={account?.id ?? null} onUpgrade={openBuyCreditsModal} />

              {/* Purchase history: every paid top-up, newest first. */}
              {purchases.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white p-5">
                  <p className="text-[13px] font-bold text-gray-800">Purchase history</p>
                  <div className="mt-2 divide-y divide-gray-100">
                    {purchases.map((p) => (
                      <div key={p.razorpay_order_id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-800">{p.credits.toLocaleString('en-IN')} credits</p>
                          <p className="truncate text-[11px] text-gray-400">
                            {new Date(p.paid_at ?? p.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                            {p.razorpay_payment_id ? ` · ${p.razorpay_payment_id}` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 font-semibold tabular-nums text-gray-800">₹{(p.amount_inr_paise / 100).toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Earn credits — only worth showing while something is unearned */}
              {CREDIT_MILESTONES.some(m => !earnedMilestones.has(m.key)) && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
                  <p className="text-[13px] font-bold text-gray-800">Earn more credits</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 mb-3">One-off bonuses, added the moment you qualify.</p>
                  <div className="divide-y divide-emerald-100">
                    {CREDIT_MILESTONES.map(({ key, label, amount, hint }) => {
                      const earned = earnedMilestones.has(key);
                      return (
                        <div key={key} className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0 flex items-start gap-2">
                            <div className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${earned ? 'bg-emerald-600' : 'border border-emerald-300 bg-white'}`}>
                              {earned && <Check size={9} className="text-white" strokeWidth={3} />}
                            </div>
                            <div className="min-w-0">
                              <p className={`text-[13px] font-semibold ${earned ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{label}</p>
                              <p className="text-[11px] text-gray-400 mt-0.5">{earned ? 'Earned' : hint}</p>
                            </div>
                          </div>
                          <span className={`shrink-0 text-[13px] font-bold ${earned ? 'text-gray-400' : 'text-emerald-700'}`}>+{amount}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Credit costs by feature */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <p className="text-[13px] font-bold text-gray-800">Credit costs by feature</p>
                <p className="text-[11px] text-gray-400 mt-0.5 mb-3">What actually gets deducted from your balance — free and Pro pay the same rates.</p>
                <div className="divide-y divide-gray-100">
                  {CREDIT_COST_ITEMS.map(({ label, cost, note }) => (
                    <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-gray-700">{label}</p>
                        {note && <p className="text-[11px] text-gray-400 mt-0.5">{note}</p>}
                      </div>
                      <span className="shrink-0 text-[13px] font-bold text-gray-900">{cost}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Count cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                {[
                  {
                    label: 'Balance',
                    value: fmtBalance(balance),
                    sub: 'Available credits',
                    icon: Zap,
                    color: '#10b981',
                  },
                  {
                    label: 'Total Users',
                    value: String(totalUsersInAccount),
                    sub: 'In this account',
                    icon: Users,
                    color: '#0f766e',
                  },
                  {
                    label: 'AI Ops',
                    value: String(totalOps),
                    sub: 'Free searches & lookups',
                    icon: Search,
                    color: '#8b5cf6',
                  },
                ].map(({ label, value, sub, icon: Icon, color }) => (
                  <div key={label} className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
                      <Icon size={13} style={{ color }} />
                    </div>
                    <p className="mt-2 text-[19px] font-extrabold text-gray-900 leading-none">{value}</p>
                    <p className="mt-1 text-[11px] text-gray-400">{sub}</p>
                  </div>
                ))}
              </div>

            </div>

            {/* ── RIGHT: Credits panel ───────────────────────────── */}
            <div className="w-full lg:w-72 shrink-0 flex flex-col gap-3">

              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Credits</p>
                <p className="mt-1 text-2xl font-extrabold text-emerald-600">{fmtBalance(balance)}</p>
                <p className="mt-1 text-[12px] text-gray-500">1 credit = 1 match (₹0.25). Everything else is free. Credits never expire.</p>
                <button onClick={openBuyCreditsModal}
                  className="mt-3 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-sm transition hover:bg-blue-700">
                  Buy more credits
                </button>
              </div>

            </div>

          </div>
        </div>
      </div>

      {/* ── Buy credits modal ─────────────────────────────────────────────── */}
      {showBuyCreditsModal && (
        <BuyCreditsModal
          offerSecondsLeft={offerLive ? offerSecondsLeft : 0}
          selectedCreditTier={selectedCreditTier}
          setSelectedCreditTier={setSelectedCreditTier}
          buyingCredits={buyingCredits}
          onClose={() => setShowBuyCreditsModal(false)}
          onSubmit={handleBuyCredits}
        />
      )}

      {purchaseResult && (
        // After a top-up: a clear result instead of a toast that is easy to miss.
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
            <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${purchaseResult.confirmed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
              {purchaseResult.confirmed ? <Check size={24} strokeWidth={3} /> : <LogoSpinner size={20} />}
            </div>
            <h2 className="text-[17px] font-bold text-gray-900">
              {purchaseResult.confirmed ? 'Payment successful' : 'Payment received'}
            </h2>
            <p className="mt-1 text-[13px] text-gray-600">
              {purchaseResult.confirmed
                ? `${purchaseResult.credits.toLocaleString('en-IN')} credits added to your account.`
                : `We're confirming it with Razorpay. ${purchaseResult.credits.toLocaleString('en-IN')} credits will appear in a few minutes.`}
            </p>
            {purchaseResult.confirmed && purchaseResult.balance != null && (
              <p className="mt-3 text-[13px] text-gray-500">
                New balance <span className="font-bold tabular-nums text-gray-900">{Math.floor(purchaseResult.balance).toLocaleString('en-IN')}</span> credits
              </p>
            )}
            {purchaseResult.paymentId && (
              <p className="mt-2 text-[11px] text-gray-400">Payment ID {purchaseResult.paymentId}</p>
            )}
            <button
              type="button"
              onClick={() => setPurchaseResult(null)}
              className="mt-5 w-full rounded-xl bg-blue-600 py-2.5 text-[14px] font-semibold text-white transition hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

// ── Billing summary panel ─────────────────────────────────────────────────
interface BreakdownItem { fn: string; count: number; cost: number; tokens: number }
interface DonutSeg2 { label: string; value: number; color: string }

function VisualAnalytics({
  breakdown, donutSegs, dailySeries, totalCost, totalOps, insights,
}: {
  breakdown: BreakdownItem[];
  donutSegs: DonutSeg2[];
  dailySeries: number[];
  totalCost: number;
  totalOps: number;
  insights: string[];
}) {
  if (breakdown.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <BarChart2 size={28} className="text-gray-200" />
        <p className="text-[15px] font-semibold text-gray-500">No usage data for this period</p>
        <p className="text-[13px] text-gray-400 max-w-xs">Start using AI features to build momentum and unlock more value from your plan.</p>
      </div>
    );
  }

  const maxCost = breakdown[0]?.cost ?? 0;

  return (
    <div className="p-5 space-y-5">
      {/* Top row: donut + sparkline */}
      <div className="grid grid-cols-2 gap-4">
        {/* Category donut */}
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-3">Spend by Category</p>
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <MiniDonut segs={donutSegs.map(s => ({ value: s.value, color: s.color }))} size={80} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[11px] font-bold text-gray-700">{totalOps}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              {donutSegs.slice(0, 5).map(s => (
                <div key={s.label} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-[11px] text-gray-600 truncate">{s.label}</span>
                  </div>
                  <span className="text-[11px] font-semibold text-gray-700 shrink-0">
                    {totalCost > 0 ? `${(s.value / totalCost * 100).toFixed(0)}%` : '0%'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Daily trend */}
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Spend Trend</p>
            {dailySeries.length >= 2 && (
              <div className="flex items-center gap-1 text-[11px]">
                {dailySeries[dailySeries.length - 1] >= dailySeries[0]
                  ? <TrendingUp size={10} className="text-red-400" />
                  : <TrendingDown size={10} className="text-emerald-400" />
                }
                <span className={dailySeries[dailySeries.length - 1] >= dailySeries[0] ? 'text-red-400' : 'text-emerald-400'}>
                  {dailySeries.length > 1
                    ? `${Math.abs(((dailySeries[dailySeries.length - 1] - dailySeries[0]) / Math.max(dailySeries[0], 0.001)) * 100).toFixed(0)}% vs first`
                    : ''}
                </span>
              </div>
            )}
          </div>
          <Sparkline data={dailySeries} color="#3b82f6" height={48} />
          <p className="text-[11px] text-gray-400 mt-2">Daily credit spend over period</p>
        </div>
      </div>

      {/* Breakdown bars */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-3">
          Operations Breakdown <span className="text-gray-300 font-normal ml-1">— cost + volume</span>
        </p>
        <div className="space-y-2.5">
          {breakdown.map(({ fn, count, cost, tokens }) => {
            const cat = fnCategory(fn);
            const color = CAT_COLORS[cat] ?? '#94a3b8';
            const pct = maxCost > 0 ? (cost / maxCost) * 100 : 0;
            const Icon = fnIcon(fn);
            return (
              <div key={fn} className="group relative rounded-xl border border-gray-100 bg-white px-4 py-3 hover:border-gray-200 hover:shadow-sm transition-all">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}15` }}>
                    <Icon size={11} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-gray-800">{FN_LABELS[fn] ?? fn}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md font-medium" style={{ backgroundColor: `${color}15`, color }}>
                        {cat}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[13px] font-bold text-gray-800">-{fmtCredits(cost)}</p>
                    <p className="text-[11px] text-gray-400">{count}× calls</p>
                  </div>
                </div>
                {/* bar */}
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
                <div className="flex justify-between mt-1.5 text-[11px] text-gray-400">
                  <span>avg {fmtCredits(cost / count)}/call</span>
                  <span className="flex items-center gap-1.5">
                    {tokens > 0 && <><Cpu size={9} />{fmtK(tokens)} tokens</>}
                    <span>{pct.toFixed(0)}% of spend</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Insights */}
      {insights.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Key Highlights</p>
          <div className="grid grid-cols-2 gap-2">
            {insights.map((txt, i) => {
              const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444'];
              const icons  = [TrendingUp, Check, Cpu, Activity, AlertCircle];
              const color  = colors[i % colors.length];
              const Icon   = icons[i % icons.length] as React.FC<{ size: number; className?: string }>;
              return <Insight key={i} icon={Icon} text={txt} accent={color} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Team Analytics panel ────────────────────────────────────────────────────
function TeamAnalytics({ logs, userNames }: { logs: UsageRow[]; userNames: Record<string, string> }) {
  const rows = useMemo(() => {
    const byUser: Record<string, { name: string; cost: number; ops: number; lastSeen: string }> = {};
    for (const row of logs) {
      const key = row.user_id ?? '__system__';
      const name = row.user_id ? (userNames[row.user_id] ?? 'Unknown') : 'System / Automation';
      if (!byUser[key]) byUser[key] = { name, cost: 0, ops: 0, lastSeen: row.created_at };
      byUser[key].cost += (row.cost_usd ?? 0) * MARKUP;
      byUser[key].ops++;
      if (row.created_at > byUser[key].lastSeen) byUser[key].lastSeen = row.created_at;
    }
    return Object.entries(byUser)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.cost - a.cost);
  }, [logs, userNames]);

  const totalCost = rows.reduce((s, r) => s + r.cost, 0);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Users size={20} className="text-gray-200" />
        <p className="text-[15px] font-semibold text-gray-500">No usage data yet</p>
      </div>
    );
  }

  const memberColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#0ea5e9', '#64748b'];

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-bold text-gray-800">Team Member Spend</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Credit usage attributed to each team member</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-gray-400">Total account spend</p>
          <p className="text-[17px] font-extrabold text-gray-900">{fmtCredits(totalCost)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const pct = totalCost > 0 ? (row.cost / totalCost) * 100 : 0;
          const color = row.key === '__system__' ? '#94a3b8' : memberColors[i % memberColors.length];
          const isSystem = row.key === '__system__';
          return (
            <div key={row.key} className="bg-gray-50 rounded-xl p-3.5 hover:bg-gray-100/60 transition-colors">
              <div className="flex items-center gap-3 mb-2.5">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-white text-[12px] font-extrabold"
                  style={{ backgroundColor: color }}>
                  {isSystem ? <Activity size={14} /> : row.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-800 truncate">{row.name}</p>
                  <p className="text-[11px] text-gray-400">{row.ops} operation{row.ops !== 1 ? 's' : ''} · last {timeAgo(row.lastSeen)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[15px] font-extrabold" style={{ color }}>{fmtCredits(row.cost)}</p>
                  <p className="text-[11px] text-gray-400">{pct.toFixed(1)}% of total</p>
                </div>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary bar */}
      <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
        {rows.map((row, i) => {
          const pct = totalCost > 0 ? (row.cost / totalCost) * 100 : 0;
          const color = row.key === '__system__' ? '#94a3b8' : memberColors[i % memberColors.length];
          return <div key={row.key} style={{ width: `${pct}%`, backgroundColor: color }} title={`${row.name}: ${pct.toFixed(1)}%`} />;
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {rows.map((row, i) => {
          const color = row.key === '__system__' ? '#94a3b8' : memberColors[i % memberColors.length];
          return (
            <div key={row.key} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[11px] text-gray-500 truncate max-w-[120px]">{row.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Usage Log panel ────────────────────────────────────────────────────────
function UsageLog({
  logs, view, page, totalPages, total, onPage, userNames,
}: {
  logs: UsageRow[];
  view: 'table' | 'cards';
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
  userNames: Record<string, string>;
}) {
  if (logs.length === 0 && page === 1) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Zap size={20} className="text-gray-200" />
        <p className="text-[15px] font-semibold text-gray-500">No usage records</p>
      </div>
    );
  }

  return (
    <>
      {view === 'table' ? (
        <table className="w-full text-[13px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide">Operation</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide hidden md:table-cell">User</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide">Credits</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide hidden md:table-cell">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {logs.map(row => {
              const cost = (row.cost_usd ?? 0) * MARKUP;
              const cat  = fnCategory(row.function_name);
              const color = CAT_COLORS[cat] ?? '#94a3b8';
              const Icon = fnIcon(row.function_name);
              return (
                <tr key={row.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}15` }}>
                        <Icon size={10} style={{ color }} />
                      </div>
                      <span className="font-semibold text-gray-800">{FN_LABELS[row.function_name] ?? row.function_name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    <span className="text-[11px] text-gray-500">{row.user_id ? (userNames[row.user_id] ?? 'Unknown') : 'System'}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`font-semibold ${cost > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                      {cost > 0 ? `-${fmtCredits(cost)}` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-400 text-[11px] hidden md:table-cell whitespace-nowrap">{timeAgo(row.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="p-4 grid grid-cols-2 gap-3">
          {logs.map(row => {
            const cost  = (row.cost_usd ?? 0) * MARKUP;
            const cat   = fnCategory(row.function_name);
            const color = CAT_COLORS[cat] ?? '#94a3b8';
            const Icon  = fnIcon(row.function_name);
            return (
              <div key={row.id} className="rounded-xl border border-gray-100 p-3 hover:border-gray-200 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}15` }}>
                      <Icon size={13} style={{ color }} />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-gray-800 leading-tight">{FN_LABELS[row.function_name] ?? row.function_name}</p>
                      <p className="text-[11px]" style={{ color }}>{cat}</p>
                    </div>
                  </div>
                  <span className={`text-[13px] font-bold shrink-0 ${cost > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {cost > 0 ? `-${fmtCredits(cost)}` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>{row.user_id ? (userNames[row.user_id] ?? 'Unknown') : 'System'}</span>
                  <span>{timeAgo(row.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
        <span className="text-[12px] text-gray-400">
          {total === 0 ? '0 records' : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft size={12} />
          </button>
          {(() => {
            const pages: (number | '…')[] = [];
            if (totalPages <= 5) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
            else {
              pages.push(1);
              if (page > 3) pages.push('…');
              for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
              if (page < totalPages - 2) pages.push('…');
              pages.push(totalPages);
            }
            return pages.map((p, i) =>
              p === '…'
                ? <span key={`e${i}`} className="w-7 h-7 flex items-center justify-center text-[12px] text-gray-400">…</span>
                : <button key={p} onClick={() => onPage(p as number)}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg text-[12px] font-semibold transition-colors ${
                      p === page ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-500 hover:border-gray-400'
                    }`}>{p}</button>
            );
          })()}
          <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </>
  );
}

// ── Tier comparison widget (currently unused, kept for potential future use) ──
// ── Buy credits modal ────────────────────────────────────────────────────────
// The first-purchase offer doubles these packs only.
const OFFER_TIERS = [249, 250, 500];

// New matches must reach this match %. Paid accounts choose 50-80%; free
// accounts match at 70%. Higher means fewer, stronger matches and less spent.
function MinMatchSetting({ accountId, onUpgrade }: { accountId: string | null; onUpgrade: () => void }) {
  const [value, setValue] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [paid, setPaid] = useState<boolean | null>(null);
  useEffect(() => {
    if (!accountId) return;
    void supabase.rpc('get_match_caps' as never).then(({ data }: { data: { paid?: boolean } | null }) => setPaid(Boolean(data?.paid)));
    void supabase.from('accounts').select('match_min_score' as never).eq('id', accountId).maybeSingle()
      .then(({ data }: { data: { match_min_score?: number } | null }) => setValue(data?.match_min_score ?? 70));
  }, [accountId]);
  const change = async (next: number) => {
    if (!paid) return;
    setValue(next);
    setSaved(false);
    const { error } = await supabase.rpc('set_match_min_score' as never, { p_score: next } as never);
    if (!error) setSaved(true);
  };
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-gray-800">Minimum match</p>
          <p className="mt-0.5 text-[12px] text-gray-500">
            {paid === false
              ? 'Free accounts match at 70%. On any paid plan, choose 50–80%: lower for more matches, higher for fewer, stronger ones.'
              : 'New matches must reach this score. Higher means fewer, stronger matches.'}
          </p>
        </div>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Minimum match">
          {[50, 55, 60, 65, 70, 75, 80].map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={value === v}
              onClick={() => void change(v)}
              disabled={value == null || !paid}
              className={`h-8 rounded-lg px-2.5 text-[12.5px] font-bold tabular-nums transition-colors disabled:cursor-not-allowed ${value === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:hover:bg-gray-100'}`}
            >
              {v}%
            </button>
          ))}
        </div>
      </div>
      {saved && <p className="mt-2 text-[11.5px] font-semibold text-emerald-600">Saved. New matches use {value}%.</p>}
      <a href="/settings/matching" className="mt-2 inline-block text-[12px] font-semibold text-blue-600 hover:underline">All matching settings: daily matches, alerts, on/off</a>
      {paid === false && (
        <button type="button" onClick={onUpgrade} className="mt-3 inline-flex h-8 items-center rounded-lg bg-blue-600 px-3 text-[12.5px] font-bold text-white hover:bg-blue-700">
          Unlock with any top-up from ₹100
        </button>
      )}
    </div>
  );
}

function BuyCreditsModal({
  offerSecondsLeft, selectedCreditTier, setSelectedCreditTier, buyingCredits, onClose, onSubmit,
}: {
  // Seconds left on the first-purchase offer (₹250 and ₹500); 0 when there's no offer.
  offerSecondsLeft: number;
  /** The amount in rupees. */
  selectedCreditTier: number;
  setSelectedCreditTier: (v: number) => void;
  buyingCredits: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const amount = selectedCreditTier;
  const valid = Number.isInteger(amount) && amount >= MIN_TOPUP_INR && amount <= MAX_TOPUP_INR;
  const offerOnSelected = offerSecondsLeft > 0 && OFFER_TIERS.includes(amount);
  const matches = (valid ? amount : 0) * CREDITS_PER_RUPEE * (offerOnSelected ? 2 : 1);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <X size={15} />
        </button>
        <div className="px-6 pt-6 pb-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-blue-600 mb-3">Buy matches</p>
          {offerSecondsLeft > 0 && (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
              <span>2× matches on ₹250 and ₹500, first top-up</span>
              <span className="tabular-nums">{formatCountdown(offerSecondsLeft)}</span>
            </div>
          )}
          <div className="mb-4">
            <span className="text-3xl font-extrabold tabular-nums text-gray-900">{matches.toLocaleString('en-IN')} matches</span>
            <p className="text-[13px] text-gray-400 mt-0.5">
              {offerOnSelected && <><span className="line-through">{(amount * CREDITS_PER_RUPEE).toLocaleString('en-IN')}</span> · </>}
              ₹0.25 a match · one-time, never expire
            </p>
          </div>
          <div className="mb-3 grid grid-cols-5 gap-1.5">
            {QUICK_AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setSelectedCreditTier(a)}
                className={`rounded-lg border py-2 text-[12.5px] font-bold tabular-nums transition-colors ${a === amount ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              >
                ₹{a >= 1000 ? `${a / 1000}k` : a}
              </button>
            ))}
          </div>
          <label htmlFor="topup-amount" className="mb-1 block text-[12px] font-semibold text-gray-500">Or enter an amount</label>
          <div className="relative mb-1">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-gray-400">₹</span>
            <input
              id="topup-amount"
              type="number"
              inputMode="numeric"
              min={MIN_TOPUP_INR}
              max={MAX_TOPUP_INR}
              step={1}
              value={Number.isFinite(amount) && amount > 0 ? amount : ''}
              onChange={(e) => setSelectedCreditTier(Math.floor(Number(e.target.value) || 0))}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-8 pr-4 text-[15px] font-semibold tabular-nums text-gray-800 focus:border-blue-400 focus:outline-none"
            />
          </div>
          <p className={`mb-5 text-[12px] ${valid ? 'text-gray-400' : 'text-red-600'}`}>
            {valid ? 'Pay any amount; every ₹1 buys 4 matches.' : `Enter ₹${MIN_TOPUP_INR} to ₹${MAX_TOPUP_INR.toLocaleString('en-IN')}.`}
          </p>
          <ul className="space-y-2.5 mb-5">
            {/* Read from CREDIT_COST_ITEMS, never hand-written. */}
            {CREDIT_COST_ITEMS.map(item => item.short).map(f => (
              <li key={f} className="flex items-start gap-2.5 text-[14px] text-gray-700">
                <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                  <Check size={9} className="text-white" strokeWidth={3} />
                </div>
                {f}
              </li>
            ))}
          </ul>
          <button onClick={onSubmit} disabled={buyingCredits || !valid}
            className="w-full py-3 rounded-xl text-[15px] font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm">
            {buyingCredits && <LogoSpinner size={14} />}
            {valid ? `Pay ₹${amount.toLocaleString('en-IN')} · get ${matches.toLocaleString('en-IN')} matches` : 'Enter an amount'}
          </button>
        </div>
      </div>
    </div>
  );
}
