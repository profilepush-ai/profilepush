import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { avatarChanged, loadAvatar } from '../lib/avatar';
import { trackEvent } from '../lib/track';
import { useAuth } from '../contexts/AuthContext';
import LogoSpinner from './LogoSpinner';

// Once, after we made someone's avatar from their Google photo and turned it
// on (avatar-backfill): here it is, keep it or turn it off. Keeping it is
// their confirmation (consented_at); turning it off removes it for good.
export default function AvatarMadeNotice() {
  const { account } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<'keep' | 'off' | null>(null);
  const [kept, setKept] = useState(false);

  useEffect(() => {
    if (!account?.id) return;
    loadAvatar().then((s) => {
      const a = s.avatar;
      if (a?.status === 'active' && a.source === 'google' && !a.consented_at && a.url) setUrl(a.url);
    }).catch(() => {});
  }, [account?.id]);

  if (!url) return null;
  const act = async (action: 'use' | 'remove') => {
    setBusy(action === 'use' ? 'keep' : 'off');
    await supabase.functions.invoke('my-avatar', { body: { action } }).catch(() => null);
    trackEvent(action === 'use' ? 'avatar_kept' : 'avatar_turned_off', { from: 'notice' });
    avatarChanged();
    if (action === 'use') { setKept(true); window.setTimeout(() => setUrl(null), 1400); } else setUrl(null);
    setBusy(null);
  };

  return (
    <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[85] flex justify-center p-3 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:p-0" role="dialog" aria-label="Your AI avatar">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5" style={{ animation: 'ppFadeUp .4s ease-out both' }}>
        <div className="flex items-center gap-3.5 bg-gradient-to-br from-[#eef3ff] to-white p-4">
          <img src={url} alt="Your AI avatar" className="h-20 w-16 shrink-0 rounded-2xl object-cover object-top shadow-md" />
          <div className="min-w-0">
            <b className="block text-[16px] font-extrabold text-[#0B1A3A]">{kept ? 'It’s yours' : 'Meet your AI avatar'}</b>
            <p className="mt-0.5 text-[12.5px] leading-snug text-gray-600">
              {kept ? 'You’ll see yourself in your matches.' : 'Made from your Google photo. It shows in your match pictures and posts while you have matches left.'}
            </p>
          </div>
        </div>
        {!kept && (
          <div className="flex gap-2 p-3">
            <button type="button" onClick={() => void act('remove')} disabled={busy != null}
              className="h-11 flex-1 rounded-xl border border-gray-300 text-[14px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
              {busy === 'off' ? <LogoSpinner size={14} /> : 'Turn off'}
            </button>
            <button type="button" onClick={() => void act('use')} disabled={busy != null}
              className="inline-flex h-11 flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-[#2563EB] text-[14px] font-bold text-white hover:bg-blue-700 disabled:opacity-60">
              {busy === 'keep' ? <LogoSpinner size={14} /> : <><Check size={16} strokeWidth={3} />Keep it</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
