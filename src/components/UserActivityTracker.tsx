import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const HEARTBEAT_INTERVAL_MS = 30_000;

function getAuthSessionId(accessToken: string) {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(normalized)) as { session_id?: unknown };
    return typeof decoded.session_id === 'string' ? decoded.session_id : null;
  } catch {
    return null;
  }
}

export default function UserActivityTracker() {
  const { account, session } = useAuth();

  useEffect(() => {
    if (!account || !session?.access_token) return;

    const authSessionId = getAuthSessionId(session.access_token);
    if (!authSessionId) return;

    const heartbeat = () => {
      if (document.visibilityState !== 'visible') return;
      void supabase.rpc('track_user_activity', { p_auth_session_id: authSessionId });
    };

    heartbeat();
    const intervalId = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener('visibilitychange', heartbeat);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', heartbeat);
    };
  }, [account?.id, session?.access_token]);

  return null;
}