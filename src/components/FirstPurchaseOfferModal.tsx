import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Clock, X, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchFirstPurchaseOffer, formatCountdown, useOfferCountdown } from '../lib/first-purchase-offer';

// Shown when someone with under 50 credits who has never paid opens the app:
// double credits on their first top-up, for one hour. Once per browser
// session; the Billing page keeps showing the offer until it ends.
const SEEN_KEY = 'first_purchase_offer_seen';

export default function FirstPurchaseOfferModal() {
  const { account } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);
  const left = useOfferCountdown(expiresAt);

  const balance = account?.credits_balance ?? null;
  const accountId = account?.id ?? null;

  useEffect(() => {
    if (!accountId || balance === null || balance >= 50) return;
    if (location.pathname.startsWith('/billing')) return;
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* storage blocked */ }
    if (seen) return;
    let cancelled = false;
    void fetchFirstPurchaseOffer(accountId).then((date) => {
      if (cancelled || !date || date.getTime() <= Date.now()) return;
      setExpiresAt(date);
      setOpen(true);
      try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ }
    });
    return () => { cancelled = true; };
  }, [accountId, balance, location.pathname]);

  useEffect(() => {
    if (open && expiresAt && left === 0) setOpen(false);
  }, [open, expiresAt, left]);

  if (!open || !expiresAt) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X size={15} />
        </button>
        <div className="px-6 pb-6 pt-6">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-700">
            <Clock size={12} />
            <span className="tabular-nums">Ends in {formatCountdown(left)}</span>
          </div>
          <h2 className="text-[18px] font-extrabold leading-snug text-gray-900">Double credits on your first top-up</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
            You have {Math.max(0, Math.floor(balance ?? 0))} credits left. Pay ₹500 and get <span className="font-bold text-gray-900">1,000 credits</span> instead of 500, for the next hour only.
          </p>
          <button
            onClick={() => { setOpen(false); navigate('/billing?openPlan=1'); }}
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 text-[14px] font-bold text-white transition-colors hover:bg-blue-700"
          >
            <Zap size={15} />
            Get 1,000 credits for ₹500
          </button>
          <button onClick={() => setOpen(false)} className="mt-2 w-full py-2 text-[13px] font-medium text-gray-500 hover:text-gray-700">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
