import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const DEFAULT_SUPABASE_URL = 'https://nhwqcqzvotgdngtxulwi.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od3FjcXp2b3RnZG5ndHh1bHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjY3NDQsImV4cCI6MjA5NjQ0Mjc0NH0.DCPM9hZwqEsfmStT1beaUtp3P-uDVkCZL8xv0ZFpCss';

const envSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const envSupabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

const supabaseUrl = envSupabaseUrl || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = envSupabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY;

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

export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
  global: { fetch: fetchWithRetry },
  }
);
export async function buildSupabaseFunctionHeaders(getSession: () => Promise<{ data: { session: { access_token?: string | null } | null } }>) {
  const { data: { session } } = await getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}