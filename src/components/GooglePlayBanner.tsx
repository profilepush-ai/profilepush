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
// The button is Google's own badge, served from /public rather than hotlinked
// or redrawn. Their brand guidelines require the supplied artwork, unmodified,
// and a hand-drawn lookalike is both a trademark problem and a worse button —
// people recognise this image without reading it. Self-hosted so the banner
// costs no third-party request and cannot break when Google moves a URL.
//
// A fresh dismiss key on purpose: anyone who dismissed the old prompt did so
// about a different thing, and should be told once that the app exists.

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';
const DISMISS_KEY = 'pp_hide_play_banner_v1';

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
        <img
          src="/android-chrome-192x192.png"
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-lg"
        />

        <div className="min-w-0 flex-1">
          <p className={`truncate text-[13px] font-semibold leading-tight ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
            ProfilePush
          </p>
          {/* Not "on Google Play" — the badge beside it already says that. */}
          <p className={`truncate text-[11px] leading-tight ${isDark ? 'text-[#94A3B8]' : 'text-gray-500'}`}>
            The Android app is here
          </p>
        </div>

        <a
          href={PLAY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismiss}
          aria-label="Get ProfilePush on Google Play"
          className="shrink-0 transition active:scale-[0.98]"
        >
          {/* Google's artwork, unaltered and uncropped. 40px tall is their
              stated minimum for the web badge; the width follows the source
              aspect so it is never stretched. */}
          <img
            src="/google-play-badge.png"
            alt="Get it on Google Play"
            width={103}
            height={40}
            className="h-10 w-auto"
          />
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
