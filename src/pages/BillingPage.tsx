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
import { getBillingErrorMessage, TIERS, fmtINR, openRazorpayCheckout } from '../lib/billing-plan';
import { PlanModal } from '../components/PlanModal';

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void };
  }
}

const MARKUP = 4;
const PAGE_SIZE = 15;
// One-time credit-pack purchases: 500-credit increments up to 5000, flat ₹1/credit.
const CREDIT_TIERS = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];

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
  'parse-resume':          'Resume Parse',
  'score-job-match':       'Job Match Score',
  'radar-match':           'Job Watch AI',
  'rewrite-resume':        'Resume Rewrite',
  'rewrite-field':         'Field Rewrite',
  'generate-search-ideas': 'Search Ideas',
  'dashboard-summary':     'Dashboard AI',
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
  if (fn.includes('score') || fn.includes('radar'))    return 'AI Match';
  if (fn.includes('parse'))    return 'AI Extract';
  if (fn.includes('ideas'))    return 'AI Ideas';
  if (fn.includes('summary'))  return 'AI Insights';
  if (fn.includes('skill'))    return 'AI Skills';
  return 'Search';
}
function fnIcon(fn: string) {
  if (fn.includes('rewrite'))  return FileText;
  if (fn.includes('score'))    return Target;
  if (fn.includes('parse'))    return Layers;
  if (fn.includes('ideas'))    return Sparkles;
  if (fn.includes('summary'))  return Brain;
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
  const { account, user, subscription, membership, refreshAccount } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const autoOpenPlanRef = useRef(false);

  const [usageLogs, setUsageLogs] = useState<UsageRow[]>([]);
  const [visibleBalance, setVisibleBalance] = useState<number | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading]     = useState(true);
  const [timeframe, setTimeframe] = useState(30);
  const [activeTab, setActiveTab] = useState<'team' | 'visual' | 'log'>('team');
  const [logView, setLogView]     = useState<'table' | 'cards'>('table');
  const [page, setPage]           = useState(1);
  const [filterFn, setFilterFn]   = useState<string>('');

  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false);
  const [selectedCreditTier, setSelectedCreditTier]   = useState<number>(CREDIT_TIERS[0]);
  const [buyingCredits, setBuyingCredits]             = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [showPlanModal, setShowPlanModal]     = useState(false);
  const [selectedNewTier, setSelectedNewTier] = useState<number>(TIERS[0]);
  const [changingPlan, setChangingPlan]       = useState(false);
  const [subscribing, setSubscribing]         = useState(false);
  const [cancelling, setCancelling]           = useState(false);

  const showToast = (message: string, type: 'success' | 'error') => setToast({ message, type });

  const load = useCallback(async () => {
    const accountId = account?.id;
    if (!accountId) return;
    setLoading(true);
    const since = timeframe > 0 ? new Date(Date.now() - timeframe * 86_400_000).toISOString() : null;
    const q = supabase.from('api_usage_log').select('*').eq('account_id', accountId).order('created_at', { ascending: false });
    if (since) q.gte('created_at', since);
    const [{ data }, { data: members }, { data: balanceRow }] = await Promise.all([
      q,
      supabase.from('account_members').select('user_id, display_name, invited_email').eq('account_id', accountId),
      supabase.from('accounts').select('credits_balance').eq('id', accountId).maybeSingle(),
    ]);
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
    setSelectedCreditTier(CREDIT_TIERS[0]);
    fireCrmEvent('billing.buy_credits_button_clicked', { current_balance: balance });
    setShowBuyCreditsModal(true);
  }

  const hasActiveSub = subscription?.status === 'active';
  const isOwner = membership?.role === 'owner';
  const pendingPeriodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const canUpgrade = !hasActiveSub || TIERS.indexOf(subscription?.plan_credits ?? 0) < TIERS.length - 1;
  const canDowngrade = hasActiveSub && TIERS.indexOf(subscription?.plan_credits ?? 0) > 0;

  function openUpgradeModal() {
    const idx = hasActiveSub ? TIERS.indexOf(subscription?.plan_credits ?? 0) : -1;
    setSelectedNewTier(idx >= 0 && idx < TIERS.length - 1 ? TIERS[idx + 1] : TIERS[0]);
    fireCrmEvent('billing.upgrade_button_clicked', { current_plan_credits: subscription?.plan_credits ?? null, subscription_status: subscription?.status ?? 'inactive' });
    setShowPlanModal(true);
  }
  function openDowngradeModal() {
    if (hasActiveSub && subscription?.plan_credits) {
      const idx = TIERS.indexOf(subscription.plan_credits);
      setSelectedNewTier(idx > 0 ? TIERS[idx - 1] : subscription.plan_credits);
    }
    fireCrmEvent('billing.downgrade_button_clicked', { current_plan_credits: subscription?.plan_credits ?? null });
    setShowPlanModal(true);
  }

  async function handleSubscribe() {
    setSubscribing(true);
    try {
      const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
      const { data, error } = await supabase.functions.invoke('razorpay-create-subscription', {
        body: { plan_credits: selectedNewTier },
        headers,
      });
      if (error || !data?.subscription_id) {
        throw new Error(getBillingErrorMessage(error, 'Failed to create subscription', data?.error));
      }
      await openRazorpayCheckout({
        key: data.key_id, subscription_id: data.subscription_id,
        name: 'ProfilePush',
        description: `Pro Plan – ${fmtINR(selectedNewTier)}/month (${selectedNewTier} credits)`,
        image: '/favicon.svg',
        handler: async () => {
          fireCrmEvent('subscription.payment_success', { plan_credits: selectedNewTier, razorpay_subscription_id: data.subscription_id });
          showToast('Subscription activated! Credits will be added shortly.', 'success');
          await refreshAccount();
          setShowPlanModal(false);
        },
        prefill: { name: user?.user_metadata?.full_name ?? '', email: user?.email ?? '' },
        theme: { color: '#2563eb' },
        onDismiss: () => { fireCrmEvent('subscription.checkout_dismissed', { plan_credits: selectedNewTier }); setSubscribing(false); },
      });
    } catch (err) {
      const msg = getBillingErrorMessage(err, 'Failed to start subscription');
      fireCrmEvent('subscription.checkout_failed', { plan_credits: selectedNewTier, error: msg });
      showToast(msg, 'error');
      setSubscribing(false);
    }
  }

  async function handleChangePlan() {
    if (!subscription || selectedNewTier === subscription.plan_credits) return;
    setChangingPlan(true);
    try {
      const isUpgrade = selectedNewTier > subscription.plan_credits;
      const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
      const { data, error } = await supabase.functions.invoke('razorpay-change-plan', {
        body: { new_plan_credits: selectedNewTier },
        headers,
      });
      if (error || !data) {
        throw new Error(getBillingErrorMessage(error, 'Failed to change plan'));
      }
      if (isUpgrade && data.order_id) {
        await openRazorpayCheckout({
          key: data.key_id, order_id: data.order_id, amount: data.amount_inr_paise, currency: 'INR',
          name: 'ProfilePush',
          description: `Upgrade ₹${data.old_plan_credits} → ₹${data.new_plan_credits}`,
          image: '/favicon.svg',
          handler: async () => {
            fireCrmEvent('subscription.upgrade_payment_success', { old_plan_credits: data.old_plan_credits, new_plan_credits: data.new_plan_credits });
            showToast(`Upgraded to ${fmtINR(selectedNewTier)}/mo! Extra credits added.`, 'success');
            await refreshAccount();
            setShowPlanModal(false);
          },
          prefill: { email: user?.email ?? '' },
          theme: { color: '#2563eb' },
        });
      } else {
        const effectiveDate = data.effective_date
          ? new Date(data.effective_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'next billing date';
        fireCrmEvent('subscription.downgrade_confirmed', { old_plan_credits: data.old_plan_credits, new_plan_credits: data.new_plan_credits });
        showToast(`Downgrade to ${fmtINR(selectedNewTier)}/mo scheduled for ${effectiveDate}.`, 'success');
        await refreshAccount();
        setShowPlanModal(false);
      }
    } catch (err) {
      const msg = getBillingErrorMessage(err, 'Failed to change plan');
      fireCrmEvent('subscription.change_plan_failed', { selected_plan_credits: selectedNewTier, error: msg });
      showToast(msg, 'error');
    }
    setChangingPlan(false);
  }

  async function handleCancelSubscription() {
    if (!window.confirm(`Cancel your Pro subscription? You'll keep your credits and access until ${pendingPeriodEnd ?? 'the end of this billing cycle'}, then it won't renew.`)) return;
    setCancelling(true);
    try {
      const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
      const { data, error } = await supabase.functions.invoke('razorpay-cancel-subscription', { headers });
      if (error || !data?.ok) {
        throw new Error(getBillingErrorMessage(error, 'Failed to cancel subscription', data?.error));
      }
      fireCrmEvent('subscription.cancel_confirmed', { plan_credits: subscription?.plan_credits ?? null });
      showToast('Subscription will end at your next renewal date.', 'success');
      await refreshAccount();
    } catch (err) {
      showToast(getBillingErrorMessage(err, 'Failed to cancel subscription'), 'error');
    }
    setCancelling(false);
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
        body: { credits: selectedCreditTier },
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
        description: `${selectedCreditTier} credits`,
        image: '/favicon.svg',
        handler: async (response: Record<string, unknown>) => {
          fireCrmEvent('credits.topup_payment_success', {
            credits: selectedCreditTier,
            razorpay_order_id: data.order_id,
            razorpay_payment_id: response.razorpay_payment_id ?? null,
          });
          showToast('Payment received — credits will be added shortly.', 'success');
          await refreshAccount();
          setShowBuyCreditsModal(false);
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

              {/* 2-card pricing: Free vs Pro */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-gray-200 bg-white p-5 flex flex-col">
                  <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3 bg-yellow-100 text-yellow-700 w-fit">Free</span>
                  <p className="text-2xl font-extrabold text-gray-900">₹0<span className="text-[15px] font-semibold text-gray-500">/mo</span></p>
                  <p className="text-[13px] text-gray-500 mt-0.5 mb-4">500 credits, one time · no card required</p>
                  <ul className="space-y-2 text-[13px] text-gray-600 flex-1 mb-4">
                    {['Pulse, Jobs, Hotlist, Posts, Inbox & Tracker', 'Unlimited team members', '1 credit per email/chat draft or new post'].map(item => (
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
                  <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3 bg-white/15 text-white w-fit">Pro</span>
                  {hasActiveSub && subscription ? (
                    <>
                      <p className="text-2xl font-extrabold text-white">{fmtINR(subscription.plan_credits)}/mo</p>
                      <p className="text-[13px] text-blue-200 mt-0.5 mb-4">
                        {subscription.plan_credits.toLocaleString('en-IN')} credits every cycle
                        {subscription.cancel_at_period_end
                          ? ` · cancels ${pendingPeriodEnd ?? 'at period end'}`
                          : pendingPeriodEnd ? ` · renews ${pendingPeriodEnd}` : ''}
                      </p>
                      <div className="flex-1" />
                      <div className="flex flex-col gap-2">
                        {(canUpgrade || canDowngrade) && (
                          <button onClick={canUpgrade ? openUpgradeModal : openDowngradeModal} className="w-full rounded-xl bg-white px-4 py-2.5 text-[13px] font-bold text-blue-700 transition hover:bg-blue-50">
                            Change plan
                          </button>
                        )}
                        {!subscription.cancel_at_period_end && (
                          <button onClick={() => void handleCancelSubscription()} disabled={cancelling} className="w-full rounded-xl border border-white/30 px-4 py-2 text-[13px] font-semibold text-white/90 transition hover:bg-white/10 disabled:opacity-50">
                            {cancelling ? 'Cancelling…' : 'Cancel subscription'}
                          </button>
                        )}
                      </div>
                    </>
                  ) : subscription?.status === 'pending' ? (
                    <>
                      <p className="text-2xl font-extrabold text-white">Payment pending</p>
                      <p className="text-[13px] text-blue-200 mt-0.5 mb-4">Complete checkout to activate Pro.</p>
                      <div className="flex-1" />
                      <button onClick={openUpgradeModal} className="w-full rounded-xl bg-white px-4 py-2.5 text-[13px] font-bold text-blue-700 transition hover:bg-blue-50">
                        Complete checkout
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-extrabold text-white">{fmtINR(TIERS[0])}<span className="text-[15px] font-semibold text-blue-200">/mo</span></p>
                      <p className="text-[13px] text-blue-200 mt-0.5 mb-4">{TIERS[0].toLocaleString('en-IN')}–{TIERS[TIERS.length - 1].toLocaleString('en-IN')} credits/mo, your choice</p>
                      <ul className="space-y-2 text-[13px] text-white flex-1 mb-4">
                        {['Everything in Free', 'Delivered automatically, never run out mid-month', 'Cancel any time, keeps access till period end'].map(item => (
                          <li key={item} className="flex items-start gap-2">
                            <Check size={12} className="mt-0.5 shrink-0 text-white" />
                            {item}
                          </li>
                        ))}
                      </ul>
                      {isOwner ? (
                        <button onClick={openUpgradeModal} className="w-full rounded-xl bg-white px-4 py-2.5 text-[13px] font-bold text-blue-700 transition hover:bg-blue-50">
                          Subscribe to Pro
                        </button>
                      ) : (
                        <p className="text-[12px] text-blue-200">Only the account owner can manage subscriptions.</p>
                      )}
                    </>
                  )}
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
                <p className="mt-1 text-[12px] text-gray-500">1 credit per email draft, chat draft, or new post — never expire.</p>
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
          selectedCreditTier={selectedCreditTier}
          setSelectedCreditTier={setSelectedCreditTier}
          buyingCredits={buyingCredits}
          onClose={() => setShowBuyCreditsModal(false)}
          onSubmit={handleBuyCredits}
        />
      )}

      {/* ── Pro plan modal ─────────────────────────────────────────────────── */}
      {showPlanModal && (
        <PlanModal
          hasActiveSub={hasActiveSub}
          subscription={subscription}
          selectedNewTier={selectedNewTier}
          setSelectedNewTier={setSelectedNewTier}
          pendingPeriodEnd={pendingPeriodEnd}
          changingPlan={changingPlan}
          subscribing={subscribing}
          onClose={() => setShowPlanModal(false)}
          onSubmit={hasActiveSub ? handleChangePlan : handleSubscribe}
          user={user}
        />
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
function TierComparison({ currentUsd }: { currentUsd: number }) {
  const [open, setOpen] = useState(false);
  const TIER_INFO = [
    { credits: 500, label: '500 credits' },
    { credits: 1000, label: '1,000 credits' },
    { credits: 2000, label: '2,000 credits' },
    { credits: 3000, label: '3,000 credits' },
    { credits: 5000, label: '5,000 credits' },
  ];
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(v => !v)}>
        <div className="flex items-center gap-2">
          <Layers size={13} className="text-gray-400" />
          <span className="text-[13px] font-semibold text-gray-700">Credit Packs</span>
        </div>
        <ChevronDown size={12} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1">
          {TIER_INFO.map(t => (
            <div key={t.credits} className={`flex items-center justify-between rounded-lg px-3 py-2 text-[12px] transition-colors ${
              t.credits === currentUsd ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
            }`}>
              <div className="flex items-center gap-2">
                {t.credits === currentUsd && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                <span className={`font-semibold ${t.credits === currentUsd ? 'text-blue-700' : 'text-gray-700'}`}>{t.label}</span>

              </div>
              <span className={`font-bold ${t.credits === currentUsd ? 'text-blue-600' : 'text-gray-500'}`}>
                ₹{t.credits.toLocaleString('en-IN')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Buy credits modal ────────────────────────────────────────────────────────
function BuyCreditsModal({
  selectedCreditTier, setSelectedCreditTier, buyingCredits, onClose, onSubmit,
}: {
  selectedCreditTier: number;
  setSelectedCreditTier: (v: number) => void;
  buyingCredits: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden">
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <X size={15} />
        </button>
        <div className="px-6 pt-6 pb-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-blue-600 mb-3">Buy credits</p>
          <div className="mb-5">
            <span className="text-3xl font-extrabold text-gray-900">{selectedCreditTier.toLocaleString('en-IN')} credits</span>
            <p className="text-[13px] text-gray-400 mt-0.5">₹{selectedCreditTier.toLocaleString('en-IN')} · ₹1 per credit · one-time, no expiry</p>
          </div>
          <div className="relative mb-5">
            <select value={selectedCreditTier} onChange={e => setSelectedCreditTier(Number(e.target.value))}
              className="w-full appearance-none border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-[15px] font-semibold text-gray-800 bg-gray-50 focus:outline-none focus:border-blue-400 cursor-pointer">
              {CREDIT_TIERS.map(tier => (
                <option key={tier} value={tier}>
                  {tier.toLocaleString('en-IN')} credits — ₹{tier.toLocaleString('en-IN')}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <ul className="space-y-2.5 mb-5">
            {['1 credit per email draft', '1 credit per AI chat draft', '1 credit per new job/hotlist post', 'Credits never expire'].map(f => (
              <li key={f} className="flex items-start gap-2.5 text-[15px] text-gray-700">
                <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                  <Check size={9} className="text-white" strokeWidth={3} />
                </div>
                {f}
              </li>
            ))}
          </ul>
          <button onClick={onSubmit} disabled={buyingCredits}
            className="w-full py-3 rounded-xl text-[15px] font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm">
            {buyingCredits && <LogoSpinner size={14} />}
            {`Pay ₹${selectedCreditTier.toLocaleString('en-IN')}`}
          </button>
        </div>
      </div>
    </div>
  );
}
