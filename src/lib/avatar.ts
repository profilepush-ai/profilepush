import { supabase } from './supabase';

// The user's own avatar for their match pictures (my-avatar function).
type Avatar = { status: 'making' | 'ready' | 'active' | 'failed'; source: string | null; url: string | null; consented_at: string | null } | null;
export type AvatarState = { avatar: Avatar; google_photo: string | null; avatar_on: boolean };

export async function loadAvatar(): Promise<AvatarState> {
  const { data, error } = await supabase.functions.invoke('my-avatar', { body: { action: 'get' } });
  if (error) throw error;
  return data as AvatarState;
}
