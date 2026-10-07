import { useEffect, useState } from 'react';
import { inAndroidApp } from '../../lib/android-shell';
import { supabase } from '../../lib/supabase';

// "Also on Android" with Google's Play badge, for the marketing pages.
//
// The badge is Google's own artwork, self-hosted and unmodified (their brand
// guidelines require the supplied file; see GooglePlayBanner). 40px tall is
// their stated minimum for the web badge; the width follows the source aspect.
//
// Hidden inside the Android app itself: telling app users to install the app
// is noise. Checked on first render (user agent / full-screen viewport) and
// again after mount, by which point the Capacitor bridge has had time to land.
// Styled by each page's own scoped CSS (.pp-home / .pp-vendors / .pp-bench .andr).

export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.profilepush.app';

type Props = {
  /** Recorded with the click in Account Stats (play_store_clicks.source). */
  source: string;
  label?: string;
  className?: string;
  /** Below the fold: let the browser defer the image. */
  lazy?: boolean;
};

export default function AndroidApp({ source, label = 'Also on Android', className, lazy = false }: Props) {
  const [hidden, setHidden] = useState(() => inAndroidApp());

  useEffect(() => {
    if (inAndroidApp()) setHidden(true);
  }, []);

  if (hidden) return null;

  // Fire and forget: the link must open regardless.
  const recordClick = () => {
    void supabase.rpc('log_play_store_click' as never, { p_source: source } as never).then(() => {}, () => {});
  };

  return (
    <div className={className ? `andr ${className}` : 'andr'}>
      <span className="andr-t">{label}</span>
      <a
        href={PLAY_URL}
        target="_blank"
        rel="noopener"
        data-path="android"
        onClick={recordClick}
      >
        <img
          src="/google-play-badge.png"
          alt="Get it on Google Play"
          width={103}
          height={40}
          loading={lazy ? 'lazy' : undefined}
          decoding="async"
        />
      </a>
    </div>
  );
}
