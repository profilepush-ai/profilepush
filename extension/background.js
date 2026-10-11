// ProfilePush Apply: keeps the ProfilePush sign-in, talks to our API, and
// opens the side panel when the toolbar icon is clicked.

const SUPABASE_URL = 'https://nhwqcqzvotgdngtxulwi.supabase.co';
// The public (anon) key, as in the web app.
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od3FjcXp2b3RnZG5ndHh1bHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjY3NDQsImV4cCI6MjA5NjQ0Mjc0NH0.DCPM9hZwqEsfmStT1beaUtp3P-uDVkCZL8xv0ZFpCss';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function getSession() {
  const { session } = await chrome.storage.local.get('session');
  if (!session) return null;
  if (session.expires_at * 1000 - Date.now() > 60_000) return session;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) { await chrome.storage.local.remove('session'); return null; }
  const fresh = await res.json();
  await chrome.storage.local.set({ session: fresh });
  return fresh;
}

async function api(fn, body) {
  const session = await getSession();
  if (!session) return { error: 'signed_out' };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : { error: data.error || `Error ${res.status}`, status: res.status, ...data };
}

// From profilepush.ai: the sign-in (/extension page) and "applying for this
// profile" when a user opens a career site from Today.
chrome.runtime.onMessageExternal.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg?.type === 'pp-connect' && msg.session?.refresh_token) {
      await chrome.storage.local.set({ session: msg.session, user: msg.user ?? null });
      reply({ ok: true });
    } else if (msg?.type === 'pp-apply-context' && msg.url) {
      const { contexts = {} } = await chrome.storage.local.get('contexts');
      contexts[new URL(msg.url).origin] = { subject_id: msg.subject_id, card_id: msg.card_id ?? null, at: Date.now() };
      await chrome.storage.local.set({ contexts });
      reply({ ok: true });
    } else if (msg?.type === 'pp-ping') {
      reply({ ok: true, version: chrome.runtime.getManifest().version });
    } else reply({ ok: false });
  })();
  return true;
});

// From the side panel.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg?.type === 'api') reply(await api(msg.fn, msg.body));
    else if (msg?.type === 'signed-in') reply({ session: await getSession(), user: (await chrome.storage.local.get('user')).user ?? null });
    else if (msg?.type === 'sign-out') { await chrome.storage.local.remove(['session', 'user']); reply({ ok: true }); }
    else reply({});
  })();
  return true;
});
