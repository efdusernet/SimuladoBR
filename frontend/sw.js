// Service Worker kill-switch (hard no-cache)
// This file intentionally disables offline caching and unregisters itself.
// Purpose: eliminate any dependency on SW + Cache Storage serving stale assets.

const VERSION = 'kill-2026-01-16';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    } catch (_) {}

    try { await self.clients.claim(); } catch (_) {}

    // Tell open pages to reload (best-effort)
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        try { c.postMessage({ type: 'SW_DISABLED', version: VERSION }); } catch (_) {}
      }
    } catch (_) {}

    // Finally unregister this SW.
    try {
      if (self.registration && typeof self.registration.unregister === 'function') {
        await self.registration.unregister();
      }
    } catch (_) {}
  })());
});

// Intentionally NO fetch handler: browser network + normal HTTP caching rules apply.
