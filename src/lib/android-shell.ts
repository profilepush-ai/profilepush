// Is this page drawing behind the Android system bars?
//
// Two attempts at answering this from the user agent were wrong. The first
// looked for "; wv)", which Android WebView stopped sending when it adopted
// the reduced user agent. The second added "Version/4.0", which is correct in
// the strings I could find but evidently still did not match the device in
// question — and a third guess at a string is not worth making.
//
// So this measures instead. A browser reserves screen space for its own
// chrome: an address bar, a status bar it does not let the page under. An app
// shell does not — capacitor.config.ts points server.url at the live site and
// targetSdk 36 forces edge-to-edge, so the WebView fills the display and the
// viewport is as tall as the screen. An installed PWA behaves the same way,
// and wants the same padding, so it is correctly caught too.
//
// The user agent stays as a second opinion: if either says app shell, it is.

const CHROME_SLACK_PX = 40;

export function isAndroidWebView(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  if (!/Android/.test(ua)) return false;
  // Safari sends its own Version/ token, hence the Android requirement above.
  return /;\s*wv\)/.test(ua) || /\bVersion\/4\.0\b/.test(ua);
}

/** True when the viewport fills the screen, as it does in an app or a PWA. */
export function isFullscreenViewport(
  screenHeight?: number,
  viewportHeight?: number,
): boolean {
  const screenPx = screenHeight ?? (typeof screen === 'undefined' ? 0 : screen.height);
  const viewportPx = viewportHeight ?? (typeof window === 'undefined' ? 0 : window.innerHeight);
  if (!screenPx || !viewportPx) return false;
  return screenPx - viewportPx <= CHROME_SLACK_PX;
}

export function inAndroidApp(): boolean {
  if (typeof navigator === 'undefined') return false;
  const bridged = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (bridged?.isNativePlatform?.()) return true;
  if (isAndroidWebView()) return true;
  return /Android/.test(navigator.userAgent) && isFullscreenViewport();
}
