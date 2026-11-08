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

// ---------- notifications (Nov 7, 2026) ----------
// The server sends a few words and the screen to open; never post text, DMs or a buyer's details.

const SAFE_PATH = /^[A-Za-z0-9._-]{0,160}$/;

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = {};
  }
  const title = typeof d.title === 'string' && d.title ? d.title.slice(0, 80) : 'Backlot';
  const body = typeof d.body === 'string' ? d.body.slice(0, 240) : '';
  const path = typeof d.path === 'string' && SAFE_PATH.test(d.path) ? d.path : 'today';
  const tag = typeof d.tag === 'string' ? d.tag.slice(0, 40) : 'bl';
  event.waitUntil(
    self.registration.showNotification(title, { body, tag, renotify: true, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { path } }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.path;
  const path = typeof raw === 'string' && SAFE_PATH.test(raw) ? raw : 'today';
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const mine = open.find((c) => new URL(c.url).origin === self.location.origin);
      if (mine) {
        mine.postMessage({ type: 'backlot-go', path });
        await mine.focus();
        return;
      }
      await self.clients.openWindow(`/#${path}`);
    })(),
  );
});
