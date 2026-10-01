import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// First-purchase offer: double credits for one hour, once per account, for
// accounts that have never paid and have under 50 credits. The server decides
// eligibility and keeps the clock (get_my_first_purchase_offer), so a reload
// can't restart it; razorpay-create-credit-order adds the bonus.

let cached: { accountId: string; promise: Promise<Date | null> } | null = null;

export function fetchFirstPurchaseOffer(accountId: string, refresh = false): Promise<Date | null> {
  if (!refresh && cached?.accountId === accountId) return cached.promise;
  const promise = (async () => {
    const { data, error } = await supabase.rpc('get_my_first_purchase_offer' as never);
    if (error) return null;
    const row = ((data as Array<{ expires_at: string }> | null) ?? [])[0];
    return row ? new Date(row.expires_at) : null;
  })();
  cached = { accountId, promise };
  return promise;
}

// Seconds left on the offer, ticking every second; 0 once it has ended.
export function useOfferCountdown(expiresAt: Date | null): number {
  const [left, setLeft] = useState(() => (expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) : 0));
  useEffect(() => {
    if (!expiresAt) { setLeft(0); return; }
    const tick = () => setLeft(Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return left;
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
