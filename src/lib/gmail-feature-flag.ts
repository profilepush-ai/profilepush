// The Gmail send/sync feature is gated to a small allowlist while the Google OAuth
// app is pending verification — anyone else hits Google's "app not verified" block
// screen if they try to connect, so we show "Coming soon" instead of a dead end.
// Remove this gate once the app is verified and published to production.
const GMAIL_FEATURE_ALLOWED_EMAILS = new Set([
  'profilepush.ai@gmail.com',
  'poornapotluri27@gmail.com',
]);

export function isGmailFeatureEnabled(email?: string | null): boolean {
  if (!email) return false;
  return GMAIL_FEATURE_ALLOWED_EMAILS.has(email.trim().toLowerCase());
}
