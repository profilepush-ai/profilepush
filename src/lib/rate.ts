import { Capacitor } from '@capacitor/core';
import { InAppReview } from '@capacitor-community/in-app-review';
import { trackEvent } from './track';

// Ratings on Google Play. Google's own in-app dialog (stars, without leaving
// the app) comes up by itself at happy moments, never after a question of
// ours and never from a button (Google may not show it then). The Settings
// "Rate us" opens the Play listing, where every rating goes.

export const PLAY_APP_ID = 'com.profilepush.app';
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${PLAY_APP_ID}`;
const ASKED_KEY = 'pp_play_review_at';
const EVERY_MS = 60 * 86_400_000;

const onAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

// After a good moment (a finished reel with an apply, an interview, a
// placement), at most every 60 days. Google decides whether it shows.
export function maybeAskForPlayReview(where: string) {
  if (!onAndroidApp()) return;
  try {
    if (Date.now() - Number(localStorage.getItem(ASKED_KEY) || 0) < EVERY_MS) return;
    localStorage.setItem(ASKED_KEY, String(Date.now()));
  } catch { return; }
  void InAppReview.requestReview().then(() => trackEvent('play_review_requested', { where })).catch(() => {});
}

// "Rate us": the Play listing (in the Play Store app on Android).
export function rateOnPlay(stars?: number) {
  trackEvent('play_rate_clicked', stars ? { stars } : {});
  window.open(onAndroidApp() ? `market://details?id=${PLAY_APP_ID}` : PLAY_URL, '_blank', 'noopener');
}
