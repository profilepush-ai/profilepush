import { createClient, navigatorLock, NavigatorLockAcquireTimeoutError } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const DEFAULT_SUPABASE_URL = 'https://nhwqcqzvotgdngtxulwi.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od3FjcXp2b3RnZG5ndHh1bHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjY3NDQsImV4cCI6MjA5NjQ0Mjc0NH0.DCPM9hZwqEsfmStT1beaUtp3P-uDVkCZL8xv0ZFpCss';

const envSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const envSupabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

const supabaseUrl = envSupabaseUrl || DEFAULT_SUPABASE_URL;
// Exported for the few callers that fetch an edge function directly rather
// than through supabase.functions.invoke (streaming responses, which invoke
// buffers).
export const supabaseAnonKey = envSupabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY;
export const supabaseFunctionsUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabaseConfigMissing = {
  url: !envSupabaseUrl,
  anonKey: !envSupabaseAnonKey,
};

if (!envSupabaseUrl || !envSupabaseAnonKey) {
  console.error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Using built-in public defaults for this project.'
  );
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(input, init);
    if (response.status !== 503) return response;
    lastResponse = response;
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
  return lastResponse!;
}

// supabase-js guards the stored session with a cross-tab lock and, for
// loading the session on start-up, waits for it with no timeout at all. Chrome
// on Android freezes background tabs, and a frozen ProfilePush tab that was
// holding the lock never releases it — so every new tab sat on the auth
// spinner forever (seen on /signup for a signed-in phone). Waits that were
// meant to be unbounded now give up after a few seconds and run anyway; the
// short "only if free" waits the auto-refresh uses are left exactly as they
// were, so tabs still don't refresh the token all at once.
// Once a wait has timed out the holder is almost certainly frozen, so for a
// while after that the unbounded waits skip the lock instead of each paying
// the full wait again (start-up makes several in a row).
const AUTH_LOCK_MAX_WAIT_MS = 3000;
const AUTH_LOCK_SKIP_MS = 60_000;
let skipAuthLockUntil = 0;

async function authLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  if (acquireTimeout >= 0) return navigatorLock(name, acquireTimeout, fn);
  if (Date.now() < skipAuthLockUntil) return fn();
  try {
    return await navigatorLock(name, AUTH_LOCK_MAX_WAIT_MS, fn);
  } catch (error) {
    // An aborted wait surfaces as the browser's AbortError, not supabase's own
    // timeout error, so both count as "gave up waiting".
    const timedOut = error instanceof NavigatorLockAcquireTimeoutError || (error as { name?: string } | null)?.name === 'AbortError';
    if (timedOut) {
      skipAuthLockUntil = Date.now() + AUTH_LOCK_SKIP_MS;
      return fn();
    }
    throw error;
  }
}

export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
  global: { fetch: fetchWithRetry },
  auth: { lock: authLock },
  }
);
export async function buildSupabaseFunctionHeaders(getSession: () => Promise<{ data: { session: { access_token?: string | null } | null } }>) {
  const { data: { session } } = await getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}