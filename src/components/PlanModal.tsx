import { ChevronDown, Check, X, ArrowUpRight, ArrowDownRight, BarChart2, Clock, Activity, Layers, Search, FileText, Sparkles, Target, Users, Cpu } from 'lucide-react';
import LogoSpinner from './LogoSpinner';
import { fmtINR, TIERS } from '../lib/billing-plan';
import type { Subscription } from '../contexts/AuthContext';

export function PlanModal({
  hasActiveSub, subscription, selectedNewTier, setSelectedNewTier, pendingPeriodEnd,
  changingPlan, subscribing, onClose, onSubmit, user,
}: {
  hasActiveSub: boolean;
  subscription: Subscription | null;
  selectedNewTier: number;
  setSelectedNewTier: (v: number) => void;
  pendingPeriodEnd: string | null;
  changingPlan: boolean;
  subscribing: boolean;
  onClose: () => void;
  onSubmit: () => void;
  user: { email?: string; user_metadata?: Record<string, unknown> } | null;
}) {
  const isUpgrade = hasActiveSub && subscription ? selectedNewTier > subscription.plan_amount_usd : false;
  const isSame = hasActiveSub && subscription ? selectedNewTier === subscription.plan_amount_usd : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X size={16} />
        </button>

        <div className="grid grid-cols-[1fr_1fr]">
          <div
            className="px-6 py-7 flex flex-col"
            style={{ background: 'linear-gradient(145deg, #1d4ed8 0%, #2563eb 50%, #1e40af 100%)' }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-white/80 mb-5">
              {hasActiveSub ? 'Change Plan' : 'Pro Plan'}
            </p>
            <div className="mb-5">
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-4xl font-extrabold text-white">₹{(selectedNewTier * 100).toLocaleString('en-IN')}</span>
                <span className="text-blue-200 text-sm pb-1">/ month</span>
              </div>
              <p className="text-sm font-semibold text-yellow-300">${selectedNewTier} in AI credits/month</p>
            </div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-blue-200 mb-2 block">Select Plan</label>
            <div className="relative mb-4">
              <select
                value={selectedNewTier}
                onChange={e => setSelectedNewTier(Number(e.target.value))}
                className="w-full appearance-none border border-white/25 text-white rounded-xl px-4 py-3 pr-10 text-sm font-semibold focus:outline-none focus:border-white/60 cursor-pointer"
                style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
              >
                {TIERS.map(tier => (
                  <option key={tier} value={tier} style={{ backgroundColor: '#1e3a8a', color: '#fff' }}>
                    ₹{(tier * 100).toLocaleString('en-IN')}/mo — ${tier} credits{subscription?.plan_amount_usd === tier && hasActiveSub ? ' (current)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 pointer-events-none" />
            </div>
            <div className="rounded-xl p-3 mb-4 space-y-2 border border-white/20" style={{ backgroundColor: 'rgba(255,255,255,0.10)' }}>
              <div className="flex justify-between text-sm">
                <span className="text-blue-200">Charged in INR</span>
                <span className="font-bold text-white">₹{(selectedNewTier * 100).toLocaleString('en-IN')}/mo</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-blue-200">AI credits / month</span>
                <span className="font-semibold text-yellow-300">${selectedNewTier}</span>
              </div>
            </div>
            {hasActiveSub && subscription && !isSame && (
              <div className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 mb-4 ${
                isUpgrade ? 'bg-emerald-400/20 border border-emerald-300/30 text-emerald-200'
                  : 'bg-amber-400/20 border border-amber-300/30 text-amber-200'
              }`}>
                {isUpgrade ? <ArrowUpRight size={13} className="shrink-0 mt-0.5" /> : <ArrowDownRight size={13} className="shrink-0 mt-0.5" />}
                <span>
                  {isUpgrade
                    ? 'Upgrade — prorated charge for remaining period, extra credits added immediately.'
                    : `Downgrade — effective ${pendingPeriodEnd ?? 'at next renewal'}.`}
                </span>
              </div>
            )}
            <div className="mt-auto">
              <button
                onClick={onSubmit}
                disabled={isSame || changingPlan || subscribing}
                className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-md"
                style={{ background: 'linear-gradient(135deg, #facc15 0%, #f97316 50%, #2563eb 100%)' }}
              >
                {(changingPlan || subscribing) && <LogoSpinner size={14} />}
                {hasActiveSub
                  ? isSame ? 'Already on this plan' : isUpgrade ? `Upgrade to ${fmtINR(selectedNewTier)}/mo` : `Downgrade to ${fmtINR(selectedNewTier)}/mo`
                  : `Upgrade Now — ${fmtINR(selectedNewTier)}/mo`}
              </button>
              <p className="text-[10px] text-blue-300/60 text-center mt-2">Payments processed in INR via Razorpay</p>
            </div>
          </div>

          <div className="px-6 py-7 flex flex-col bg-white">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">What's included</p>
            <p className="text-base font-bold text-gray-900 mb-5">Everything you need to run recruiting ops.</p>
            <ul className="space-y-3 flex-1">
              {[
                ['All AI features unlocked', Users],
                ['Multi-board job search', Search],
                ['Candidate onboarding portal', FileText],
                ['Role-based access control', Layers],
                ['Unlimited team members', Users],
                ['Profile & bench management', Activity],
                ['Vendor & client directory', Target],
                ['Usage analytics & insights', BarChart2],
                ['Activity audit log', Clock],
              ].map(([label, Icon]) => (
                <li key={label as string} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                    <Check size={9} className="text-white" strokeWidth={3} />
                  </div>
                  <p className="text-sm font-medium text-gray-700">{label as string}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
