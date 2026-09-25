import { describe, expect, it } from 'vitest';
import { isAndroidWebView } from './android-shell';

const UA = {
  webViewLegacy: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
  // The one the first attempt missed: reduced UA drops the "wv" token.
  webViewReduced: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  chromeDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
  // Safari sends its own Version/ token, so the check has to require Android.
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

describe('isAndroidWebView', () => {
  it('matches both the legacy and the reduced WebView user agent', () => {
    expect(isAndroidWebView(UA.webViewLegacy)).toBe(true);
    expect(isAndroidWebView(UA.webViewReduced)).toBe(true);
  });

  it('does not match a real browser', () => {
    expect(isAndroidWebView(UA.chromeAndroid)).toBe(false);
    expect(isAndroidWebView(UA.chromeDesktop)).toBe(false);
    expect(isAndroidWebView(UA.safariIphone)).toBe(false);
    expect(isAndroidWebView(UA.safariMac)).toBe(false);
  });
});
