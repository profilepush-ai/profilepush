import { supabase } from './supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export async function triggerProfileEmbedding(profileId: string): Promise<void> {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? supabaseAnonKey;
    await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ type: 'profile', id: profileId }),
    });
  } catch {
    // Fire-and-forget — embedding failure shouldn't block the user
  }
}

export async function triggerJobEmbedding(jobId: string, table: string): Promise<void> {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? supabaseAnonKey;
    await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ type: 'job', id: jobId, table }),
    });
  } catch {
    // Fire-and-forget
  }
}

export async function triggerJobEmbeddingsBatch(
  jobs: Array<{ id: string; table: string }>,
): Promise<void> {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? supabaseAnonKey;
    const payload = jobs.map(j => ({ type: 'job' as const, id: j.id, table: j.table }));
    await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Apikey': supabaseAnonKey,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Fire-and-forget
  }
}
