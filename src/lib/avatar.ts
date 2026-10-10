import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// The user's own avatar for their match pictures and their photo across
// ProfilePush while it's on (my-avatar function).
type Avatar = { status: 'making' | 'ready' | 'active' | 'failed'; source: string | null; url: string | null; consented_at: string | null } | null;
export type AvatarState = { avatar: Avatar; google_photo: string | null; avatar_on: boolean };

let cached: Promise<AvatarState> | null = null;

export function loadAvatar(fresh = false): Promise<AvatarState> {
  if (!cached || fresh) {
    cached = supabase.functions.invoke('my-avatar', { body: { action: 'get' } }).then(({ data, error }) => {
      if (error) throw error;
      return data as AvatarState;
    });
    cached.catch(() => { cached = null; });
  }
  return cached;
}

// After the avatar is made, used or removed: everything showing it updates.
export function avatarChanged() {
  cached = null;
  window.dispatchEvent(new Event('pp-avatar-changed'));
}

/** Their avatar's URL while it's on (credits or a plan), else null. */
export function useMyAvatar(enabled = true): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const read = () => loadAvatar()
      .then((s) => setUrl(s.avatar?.status === 'active' && s.avatar_on ? s.avatar.url : null))
      .catch(() => setUrl(null));
    void read();
    window.addEventListener('pp-avatar-changed', read);
    return () => window.removeEventListener('pp-avatar-changed', read);
  }, [enabled]);
  return url;
}
