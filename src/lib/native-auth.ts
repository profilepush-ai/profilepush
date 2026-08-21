import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { supabase } from './supabase';

// Google's own Identity Services SDK blocks embedded WebViews by user-agent
// (the standard "disallowed_useragent" error), so on native the app hands
// off to the system browser (Chrome Custom Tabs) instead and reads the
// session back through this deep link. The installed supabase-js client
// defaults to flowType: 'implicit', so the redirect carries the session as
// a URL fragment (#access_token=...&refresh_token=...), not a `code` param
// — exchangeCodeForSession would be the wrong call here.
export const NATIVE_AUTH_CALLBACK_URL = 'com.profilepush.app://auth-callback';

let listenerRegistered = false;

export function registerNativeAuthDeepLinkListener(): void {
  if (!Capacitor.isNativePlatform() || listenerRegistered) return;
  listenerRegistered = true;

  App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    if (!event.url.startsWith(NATIVE_AUTH_CALLBACK_URL)) return;

    void (async () => {
      await Browser.close().catch(() => {});

      const fragment = event.url.split('#')[1];
      if (!fragment) return;

      const params = new URLSearchParams(fragment);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (!accessToken || !refreshToken) return;

      await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    })();
  });
}

export async function startNativeGoogleSignIn(): Promise<{ error: string | null }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: NATIVE_AUTH_CALLBACK_URL,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    return { error: error?.message ?? 'Could not start Google sign-in' };
  }

  await Browser.open({ url: data.url });
  return { error: null };
}
