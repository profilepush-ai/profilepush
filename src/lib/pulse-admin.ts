// profilepush.ai@gmail.com is used internally to moderate spam/junk posts out of the
// shared Pulse feed. This client-side check only controls button labeling/UX — the
// actual authorization is re-checked server-side in the pulse-hide-lead edge function.
const PULSE_ADMIN_EMAILS = new Set(['profilepush.ai@gmail.com']);

export function isPulseAdmin(email?: string | null): boolean {
  if (!email) return false;
  return PULSE_ADMIN_EMAILS.has(email.trim().toLowerCase());
}
