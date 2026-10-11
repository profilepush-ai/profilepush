import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Gift, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { claimPendingReferral, rememberReferral } from '../lib/referral';
import { trackEvent } from '../lib/track';

// /r/<code>: remember who shared the link, then sign up (or, signed in, go on).
export function ReferralLanding() {
  const { code } = useParams<{ code: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (code) { rememberReferral(code); trackEvent('referral_link_opened'); }
    if (!loading) navigate(user ? '/today' : '/signin', { replace: true, state: { from: '/today' } });
  }, [code, user, loading, navigate]);
  return null;
}

// Once signed in, a remembered link is claimed: a thank-you banner shows the bonus.
export default function ReferralClaim() {
  const { user, account } = useAuth();
  const [bonus, setBonus] = useState<number | null>(null);
  useEffect(() => {
    if (!user?.id || !account?.id) return;
    void claimPendingReferral().then((b) => { if (b) { setBonus(b); trackEvent('referral_claimed', { bonus: b }); } });
  }, [user?.id, account?.id]);
  if (!bonus) return null;
  return (
    <div role="status" className="fixed inset-x-3 top-16 z-[100] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-emerald-600 px-4 py-3 text-white shadow-2xl">
      <Gift size={22} className="shrink-0" />
      <p className="min-w-0 flex-1 text-[13.5px] font-semibold">Welcome! You got {bonus} bonus credits on top of your 100, thanks to the friend who invited you.</p>
      <button type="button" onClick={() => setBonus(null)} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-white/15"><X size={18} /></button>
    </div>
  );
}
