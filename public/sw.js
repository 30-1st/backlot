// Backlot's service worker: makes the installed app open instantly and survive a weak
// connection, without ever serving an old version or touching anyone's data.
//
//   * Page loads: network first, so every deploy shows up on the next open. The last
//     good page is kept only as a fallback for when the phone is offline.
//   * Built files under /assets/ have the content hash in their names, so a cached copy
//     can never be stale: cache first.
//   * Anything else, including every request to Supabase or another site, is not touched.

const CACHE = 'backlot-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(CACHE);
            await cache.put('/', fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await caches.match('/');
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(req, fresh.clone());
        }
        return fresh;
      })(),
    );
  }
});
