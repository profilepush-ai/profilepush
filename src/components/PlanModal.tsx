import { Check, X, ChevronDown } from 'lucide-react';
import LogoSpinner from './LogoSpinner';
import { TIERS } from '../lib/billing-plan';
import type { Subscription } from '../contexts/AuthContext';

const FEATURES = [
  'Credits delivered automatically every month',
  'Unlimited team members',
  'Vendors Tracker & Bulk Export',
];

export function PlanModal({
  hasActiveSub, subscription, selectedNewTier, setSelectedNewTier, pendingPeriodEnd,
  changingPlan, subscribing, onClose, onSubmit,
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
  const isSame = hasActiveSub && subscription ? selectedNewTier === subscription.plan_credits : false;
  const isUpgrade = hasActiveSub && subscription ? selectedNewTier > subscription.plan_credits : false;
  const inr = selectedNewTier.toLocaleString('en-IN');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden">
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <X size={15} />
        </button>
        <div className="px-6 pt-6 pb-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600 mb-3">ProfilePush Pro</p>
          <div className="mb-5">
            <span className="text-3xl font-extrabold text-gray-900">₹{inr}</span>
            <span className="text-sm font-medium text-gray-400">/month</span>
            <p className="text-xs text-gray-400 mt-0.5">Billed via Razorpay</p>
          </div>
          <div className="relative mb-5">
            <select
              value={selectedNewTier}
              onChange={e => setSelectedNewTier(Number(e.target.value))}
              className="w-full appearance-none border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-semibold text-gray-800 bg-gray-50 focus:outline-none focus:border-blue-400 cursor-pointer"
            >
              {TIERS.map(tier => (
                <option key={tier} value={tier}>
                  ₹{tier.toLocaleString('en-IN')}/mo — {tier.toLocaleString('en-IN')} credits{subscription?.plan_credits === tier && hasActiveSub ? ' — current' : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <ul className="space-y-2.5 mb-5">
            {FEATURES.map(f => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-gray-700">
                <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                  <Check size={9} className="text-white" strokeWidth={3} />
                </div>
                {f}
              </li>
            ))}
          </ul>
          {hasActiveSub && subscription && !isSame && (
            <p className="text-xs text-gray-500 mb-4 text-center">
              {isUpgrade ? 'Upgrade takes effect immediately.' : `Downgrade effective ${pendingPeriodEnd ?? 'at next renewal'}.`}
            </p>
          )}
          <button
            onClick={onSubmit}
            disabled={isSame || changingPlan || subscribing}
            className="w-full py-3 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            {(changingPlan || subscribing) && <LogoSpinner size={14} />}
            {hasActiveSub
              ? isSame ? 'Already on this plan' : isUpgrade ? `Upgrade to ₹${inr}/mo` : `Switch to ₹${inr}/mo`
              : `Get Pro — ₹${inr}/mo`}
          </button>
        </div>
      </div>
    </div>
  );
}


