import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ImageUp, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { avatarChanged, loadAvatar, type AvatarState } from '../../lib/avatar';
import { trackEvent } from '../../lib/track';
import LogoSpinner from '../LogoSpinner';

// The user's own avatar for their match pictures (my-avatar function).
// Opt-in: make it from the Google photo or an upload, see it, then "Use in my
// pictures". It shows in pictures while the account has credits or a plan.


// A photo from the device, shrunk to at most 1024px, as base64 JPEG.
async function photoAsBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
}

export default function AvatarPanel() {
  const [state, setState] = useState<AvatarState | null>(null);
  const [busy, setBusy] = useState<'' | 'making' | 'using' | 'removing'>('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { loadAvatar().then(setState).catch(() => setError('Could not load your avatar.')); }, []);

  const call = async (body: Record<string, unknown>, step: typeof busy) => {
    setBusy(step); setError('');
    try {
      const { data, error: err } = await supabase.functions.invoke('my-avatar', { body });
      if (err || data?.error) throw new Error(data?.error || 'Something went wrong. Try again.');
      avatarChanged();
      setState(await loadAvatar(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy('');
    }
  };
  const makeFromGoogle = () => { trackEvent('avatar_make', { source: 'google' }); void call({ action: 'make', source: 'google' }, 'making'); };
  const makeFromUpload = async (file: File | undefined) => {
    if (!file) return;
    trackEvent('avatar_make', { source: 'upload' });
    try { void call({ action: 'make', source: 'upload', image: await photoAsBase64(file) }, 'making'); } catch { setError('That photo could not be read. Try a JPG or PNG.'); }
  };

  if (!state && !error) return <div className="flex justify-center py-6"><LogoSpinner size={18} /></div>;
  const avatar = state?.avatar ?? null;
  const shown = avatar?.url && avatar.status !== 'failed' ? avatar.url : null;
  const active = avatar?.status === 'active';
  const button = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold disabled:opacity-50';

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="relative grid h-[148px] w-[120px] shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#C8D7FA]/50 dark:bg-white/5">
        {busy === 'making' ? (
          <div className="flex flex-col items-center gap-2 px-2 text-center text-[11.5px] font-semibold text-gray-600 dark:text-slate-300"><LogoSpinner size={18} />Making your avatar, about 10 seconds</div>
        ) : shown ? (
          <img src={shown} alt="Your avatar" className="h-full w-full object-cover" />
        ) : state?.google_photo ? (
          <img src={state.google_photo} alt="Your Google photo" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-90" />
        ) : (
          <Sparkles size={28} className="text-blue-600" />
        )}
        {active && <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white"><Check size={11} strokeWidth={3} />In use</span>}
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        {active ? (
          state?.avatar_on
            ? <p className="text-[13px] text-gray-600 dark:text-slate-300">Your job matches show you, holding each job&apos;s skills.</p>
            : <p className="text-[13px] text-amber-700 dark:text-amber-300">Paused: your avatar shows while you have matches left. <Link to="/billing" className="font-semibold underline">Top up</Link> to bring it back.</p>
        ) : avatar?.status === 'ready' ? (
          <p className="text-[13px] text-gray-600 dark:text-slate-300">Here&apos;s your avatar. Use it and your job matches will show you, holding each job&apos;s skills.</p>
        ) : (
          <p className="text-[13px] text-gray-600 dark:text-slate-300">
            {state?.google_photo ? 'Make a 3D avatar from your Google photo, or upload another photo.' : 'Upload a photo of yourself and we\'ll make a 3D avatar from it.'}{' '}
            Your photo is only used to make the avatar; an uploaded photo isn&apos;t kept.
          </p>
        )}
        {error && <p className="text-[12.5px] font-semibold text-red-600">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {avatar?.status === 'ready' && (
            <button type="button" disabled={Boolean(busy)} onClick={() => { trackEvent('avatar_use'); void call({ action: 'use' }, 'using'); }} className={`${button} bg-blue-600 text-white hover:bg-blue-700`}>
              <Check size={15} strokeWidth={3} />{busy === 'using' ? 'Turning on…' : 'Use in my pictures'}
            </button>
          )}
          {state?.google_photo && (
            <button type="button" disabled={Boolean(busy)} onClick={makeFromGoogle}
              className={`${button} ${!avatar ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-white/5 dark:text-slate-200'}`}>
              {avatar ? <RefreshCw size={14} /> : <Sparkles size={15} />}{avatar ? 'Make a new one' : 'Make from my Google photo'}
            </button>
          )}
          <button type="button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}
            className={`${button} ${!avatar && !state?.google_photo ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-white/5 dark:text-slate-200'}`}>
            <ImageUp size={15} />Upload a photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void makeFromUpload(e.target.files?.[0]); e.target.value = ''; }} />
          {avatar && (
            <button type="button" disabled={Boolean(busy)} onClick={() => { if (window.confirm('Remove your avatar and every picture made with it?')) { trackEvent('avatar_remove'); void call({ action: 'remove' }, 'removing'); } }}
              className={`${button} text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10`}>
              <Trash2 size={14} />Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
