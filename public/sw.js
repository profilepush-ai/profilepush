// What makes ProfilePush installable as a desktop app.
//
// Windows offers "Install this site as an app" only for a page with a web
// manifest AND a service worker with a fetch handler. The manifest was
// already here; this is the missing half.
//
// A service worker is the most dangerous thing you can add to a site that
// deploys several times a day, because it persists across visits and can pin
// someone to a build forever. Three decisions keep that from happening:
//
// 1. Navigations are network-first. Fresh HTML always wins when online, so a
//    deploy is picked up on the next page load and a bad worker can never
//    serve a stale app. The cached copy exists only for offline.
//
// 2. Only /assets/* is cached, and cache-first is safe there because Vite
//    content-hashes those filenames — a changed file is a different URL.
//    Nothing else is cached at all: not /api/*, not Supabase, not any
//    response that could carry a session.
//
// 3. The asset cache is deliberately NOT versioned or purged on activate.
//    This app is code-split, and Pages serves only the current deployment, so
//    a tab left open across a deploy 404s when it lazy-loads a chunk that no
//    longer exists. Keeping old chunks means those tabs keep working — the
//    worker fixes a bug here rather than adding one.

const HTML_CACHE = 'profilepush-html-v1';
const ASSET_CACHE = 'profilepush-assets';

self.addEventListener('install', () => {
  // Take over straight away rather than waiting for every tab to close;
  // combined with network-first HTML, a new worker can only ever be fresher.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name !== HTML_CACHE && name !== ASSET_CACHE)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Cross-origin is Supabase, the workers and the CDNs. Left entirely alone:
  // anything with an Authorization header has no business in a cache.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(HTML_CACHE);
          await cache.put('/index.html', fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match('/index.html');
        return cached ?? Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(ASSET_CACHE);
        await cache.put(request, fresh.clone());
      }
      return fresh;
    })());
  }
});
