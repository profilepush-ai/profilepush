import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useTheme } from '../contexts/ThemeContext';

// The Play listing, in place of the old add-to-home-screen prompt.
//
// That prompt existed because there was no app — it walked people through
// Chrome's menu or Safari's share sheet to fake one. There is a real app now,
// so the instructions are gone and this points at it.
//
// A fresh dismiss key on purpose: anyone who dismissed the old prompt did so
// about a different thing, and should be told once that the app exists.

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';
const DISMISS_KEY = 'pp_hide_play_banner_v1';

/** Google's play triangle, in its four brand colours. */
function PlayMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <path fill="#00D2FF" d="M47 24 322 256 47 488c-9-6-15-17-15-31V55c0-14 6-25 15-31z" />
      <path fill="#00F076" d="M47 24c8-5 18-5 28 1l271 154-24 77z" />
      <path fill="#FFCE00" d="M346 179l70 40c24 14 24 60 0 74l-70 40-24-77z" />
      <path fill="#FF3A44" d="M75 487c-10 6-20 6-28 1l275-232 24 77z" />
    </svg>
  );
}

export default function GooglePlayBanner() {
  const { isDark } = useTheme();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      // Private browsing throws on localStorage. Showing the banner is the
      // right failure: the worst case is one dismissal that does not stick.
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* nothing to do */ }
  };

  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/i.test(navigator.userAgent);
  // Not inside the app it is advertising, and not on iOS, where there is
  // nothing on the other end of this link yet.
  if (dismissed || isIOS || Capacitor.isNativePlatform()) return null;

  return (
    <div
      className={`fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 animate-slide-up border-t px-3 py-2.5 shadow-lg
        sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[360px] sm:rounded-xl sm:border sm:px-3.5 sm:py-3 ${
        isDark ? 'border-white/10 bg-[#20242a]' : 'border-gray-200 bg-white'
      }`}
    >
      {/* One row, and it has to stay one row: the phone keeps this above the
          bottom nav, and a second line would cover the tab bar it clears. The
          offset carries the safe-area inset the nav itself pads by, or it
          rides up over the tab bar on a phone with a home indicator. */}
      <div className="flex items-center gap-2.5">
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          isDark ? 'bg-white/5' : 'bg-gray-50'
        }`}>
          <PlayMark size={18} />
        </span>

        <div className="min-w-0 flex-1">
          <p className={`truncate text-[13px] font-semibold leading-tight ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
            ProfilePush for Android
          </p>
          <p className={`truncate text-[11px] leading-tight ${isDark ? 'text-[#94A3B8]' : 'text-gray-500'}`}>
            Now on Google Play
          </p>
        </div>

        <a
          href={PLAY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismiss}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#01875f] px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-[#017050] active:scale-[0.98]"
        >
          <PlayMark size={14} />
          Install
        </a>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
            isDark ? 'text-slate-400 hover:bg-white/10' : 'text-gray-400 hover:bg-gray-100'
          }`}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
