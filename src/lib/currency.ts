import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Prices: rupees in India, US dollars everywhere else. Credits are the same
// everywhere (1 credit = 1 match, AI Apply = 4); only the price differs.
// Must match _shared/credit-tiers.ts.
export type Currency = 'INR' | 'USD';

export const PRICING = {
  INR: { currency: 'INR', locale: 'en-IN', creditsPerUnit: 4, min: 100, max: 100_000, quick: [250, 500, 1000, 2500, 5000], start: 250, offerPacks: [249, 250, 500] },
  USD: { currency: 'USD', locale: 'en-US', creditsPerUnit: 100, min: 5, max: 2_000, quick: [5, 10, 25, 50, 100], start: 10, offerPacks: [] as number[] },
} as const;

export function money(amount: number, currency: Currency, digits?: number) {
  const p = PRICING[currency];
  return new Intl.NumberFormat(p.locale, {
    style: 'currency', currency, minimumFractionDigits: digits ?? (Number.isInteger(amount) ? 0 : 2), maximumFractionDigits: digits ?? 2,
  }).format(amount);
}

const KEY = 'pp_currency';
let detected: Promise<Currency> | null = null;
// From the visitor's country (Cloudflare); in development, the time zone.
function detect(): Promise<Currency> {
  detected ??= fetch('/api/geo').then((r) => r.json()).then((g: { country?: string | null }) => {
    if (g?.country) return g.country === 'IN' ? 'INR' : 'USD';
    throw new Error('no country');
  }).catch(() => (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Kolkata' ? 'INR' : 'USD'));
  return detected;
}

/** Their currency: what they chose, else what they last paid in, else their country's. */
export function useCurrency(): [Currency, (c: Currency) => void] {
  const { account } = useAuth();
  const paid = account?.billing_currency;
  const [currency, setCurrency] = useState<Currency>(() => {
    try { const saved = localStorage.getItem(KEY); if (saved === 'INR' || saved === 'USD') return saved; } catch { /* fine */ }
    return paid === 'USD' || paid === 'INR' ? paid : 'INR';
  });
  useEffect(() => {
    let chosen: string | null = null;
    try { chosen = localStorage.getItem(KEY); } catch { /* fine */ }
    if (chosen) return;
    if (paid === 'USD' || paid === 'INR') { setCurrency(paid); return; }
    void detect().then(setCurrency);
  }, [paid]);
  const choose = (c: Currency) => { try { localStorage.setItem(KEY, c); } catch { /* fine */ } setCurrency(c); };
  return [currency, choose];
}

/** "₹0.25" / "$0.01" a match, the smallest top-up and AI Apply's price. */
export function priceLabels(currency: Currency) {
  const p = PRICING[currency];
  return {
    perMatch: money(1 / p.creditsPerUnit, currency, 2),
    minTopup: money(p.min, currency),
    aiApply: money(4 / p.creditsPerUnit, currency, 2),
    thousand: money(1000 / p.creditsPerUnit, currency),
  };
}
