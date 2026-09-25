// Is this page running inside the Android app?
//
// Shared because two things depend on it and they must agree: the system-bar
// insets in index.css, and the Play banner, which must not advertise the app
// to itself.
//
// capacitor.config.ts points server.url at the live site, so the app loads the
// same page a browser does. Capacitor.isNativePlatform() is the obvious check
// and is not enough on its own — the bridge is injected into the remote page,
// but not reliably before the first render, so an early call reports "web"
// from inside the app.
//
// The user agent is true immediately, and this is where the first attempt went
// wrong: it tested only for the "; wv)" token. Android WebView adopted the
// reduced user agent and stopped sending it. What survives in both the legacy
// and the reduced form is "Version/4.0", which Chrome for Android never sends
// — that is the marker to key on.

export function isAndroidWebView(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  if (!/Android/.test(ua)) return false;
  return /;\s*wv\)/.test(ua) || /\bVersion\/4\.0\b/.test(ua);
}

export function inAndroidApp(): boolean {
  if (typeof navigator === 'undefined') return false;
  const bridged = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (bridged?.isNativePlatform?.()) return true;
  return isAndroidWebView();
}
