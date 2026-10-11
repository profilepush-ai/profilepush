import { supabase } from './supabase';

// Refer and earn (claim_referral / my_referral). A visitor who opens
// /r/<code> has the code remembered here until they've signed in, then it's
// claimed once: they get 50 bonus credits, whoever shared it gets 100.

const KEY = 'pp_ref';

export function rememberReferral(code: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ code: code.trim().toLowerCase(), at: Date.now() })); } catch { /* fine */ }
}

/** Claims a remembered code for the signed-in user; the bonus they got, or null. */
export async function claimPendingReferral(): Promise<number | null> {
  let pending: { code?: string; at?: number } | null = null;
  try { pending = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { pending = null; }
  if (!pending?.code) return null;
  if (!pending.at || Date.now() - pending.at > 30 * 86_400_000) { try { localStorage.removeItem(KEY); } catch { /* fine */ } return null; }
  const { data, error } = await supabase.rpc('claim_referral' as never, { p_code: pending.code } as never);
  if (error) return null;
  const res = data as unknown as { ok: boolean; reason?: string; bonus?: number } | null;
  if (res?.reason === 'signed_out') return null;
  try { localStorage.removeItem(KEY); } catch { /* fine */ }
  return res?.ok ? res.bonus ?? 50 : null;
}

export type MyReferral = { code: string; joined: number; earned: number };
export async function loadMyReferral(): Promise<MyReferral | null> {
  const { data, error } = await supabase.rpc('my_referral' as never);
  if (error) throw new Error(error.message);
  return data as unknown as MyReferral | null;
}

export const referralLink = (code: string) => `https://profilepush.ai/r/${code}`;
