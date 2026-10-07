import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { trackEvent } from '../lib/track';

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
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  // Which pages signed-in people open, as product events: time on site alone
  // could not say where a new vendor went before leaving.
  useEffect(() => {
    if (!account) return;
    trackEvent('page_view', { persona: account.active_persona ?? null });
  }, [account?.id, pathname]);

  // A tapped push lands here tagged src=push (see openPushLink). Record the
  // open, mark that notification read, and drop the tags from the address.
  useEffect(() => {
    if (!account) return;
    const params = new URLSearchParams(search);
    if (params.get('src') !== 'push') return;
    const nid = params.get('nid');
    trackEvent('push_opened', { notification_id: nid, type: params.get('nt') });
    if (nid) void supabase.from('notifications').update({ read: true }).eq('id', nid).then(() => undefined, () => undefined);
    ['src', 'nid', 'nt'].forEach(k => params.delete(k));
    const rest = params.toString();
    navigate({ pathname, search: rest ? `?${rest}` : '' }, { replace: true });
  }, [account?.id, search]);

  // The Android app loads the live site, so it reports itself here once per
  // open; Admin > Emails uses it for the "users without the app" audience.
  useEffect(() => {
    if (!account || !Capacitor.isNativePlatform()) return;
    void supabase.rpc('record_app_install' as never, { p_platform: Capacitor.getPlatform() } as never).then(({ error }) => {
      if (error) console.error('record_app_install failed', error);
    });
  }, [account?.id]);

  useEffect(() => {
    if (!account || !session?.access_token) return;

    const authSessionId = getAuthSessionId(session.access_token);
    if (!authSessionId) return;

    const heartbeat = () => {
      if (document.visibilityState !== 'visible') return;
      // supabase-js query/RPC builders are lazy thenables — the request is
      // only sent once `.then()`/await is called on them. A bare `void`
      // discards the reference without ever invoking `.then()`, so this must
      // chain `.then()` itself or the heartbeat silently never fires.
      void supabase.rpc('track_user_activity', { p_auth_session_id: authSessionId }).then(({ error }) => {
        if (error) console.error('track_user_activity failed', error);
      });
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