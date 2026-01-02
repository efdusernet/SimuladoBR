// Service Worker v2.0.5 - PWA Offline-First Robusto
// Estratégias: Cache-First (assets), Network-First + Cache Fallback (API), Stale-While-Revalidate (images)
// SW context does not have window; ensure logger shim
const logger = (self && self.logger) ? self.logger : {
  debug: (...args) => { try { console.debug(...args); } catch(_){} },
  info:  (...args) => { try { console.info(...args); } catch(_){} },
  warn:  (...args) => { try { console.warn(...args); } catch(_){} },
  error: (...args) => { try { console.error(...args); } catch(_){} }
};

const VERSION = '2.0.17';
const CACHE_PREFIX = 'simuladosbr';
const CACHES = {
  STATIC: `${CACHE_PREFIX}-static-v${VERSION}`,
  DYNAMIC: `${CACHE_PREFIX}-dynamic-v${VERSION}`,
  API: `${CACHE_PREFIX}-api-v${VERSION}`,
  IMAGES: `${CACHE_PREFIX}-images-v${VERSION}`
};

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/styles.css',
  '/script.js',
  '/script_exam.js',
  '/manifest.json',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/pmi.png',
  '/pages/exam.html',
  '/pages/examFull.html',
  '/pages/examSetup.html',
  '/components/examCleanup.js'
];

// Configurações de cache
const CACHE_CONFIG = {
  maxAge: {
    static: 30 * 24 * 60 * 60 * 1000,  // 30 dias
    api: 5 * 60 * 1000,                 // 5 minutos
    dynamic: 7 * 24 * 60 * 60 * 1000,   // 7 dias
    images: 30 * 24 * 60 * 60 * 1000    // 30 dias
  },
  maxEntries: {
    api: 50,
    dynamic: 100,
    images: 200
  }
};

// ============================================
// INSTALL
// ============================================
self.addEventListener('install', event => {
  logger.info(`[SW v${VERSION}] Installing...`);
  
  event.waitUntil(
    caches.open(CACHES.STATIC)
      .then(cache => {
        logger.info('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      })
      .then(() => {
        logger.info('[SW] Static assets cached, skipping waiting');
        return self.skipWaiting();
      })
      .catch(err => {
        logger.error('[SW] Install failed:', err);
        return Promise.reject(err);
      })
  );
});

// ============================================
// ACTIVATE
// ============================================
self.addEventListener('activate', event => {
  logger.info(`[SW v${VERSION}] Activating...`);
  
  event.waitUntil(
    Promise.all([
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => {
              return name.startsWith(CACHE_PREFIX) && 
                     !Object.values(CACHES).includes(name);
            })
            .map(name => {
              logger.info('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      }),
      self.clients.claim()
    ]).then(() => {
      logger.info('[SW] Activation complete, controlling all clients');
    })
  );
});

// ============================================
// FETCH - Estratégias de cache
// ============================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // IMPORTANT: do not cache chat-service API routes.
  // The widget relies on fresh network responses for messages; caching GET /chat/v1/**
  // can cause "host -> widget" messages to appear stuck while "widget -> host" (POST) works.
  if (url.pathname.startsWith('/chat/v1/')) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
    return;
  }

  function cacheKeyWithoutSearch(u) {
    try {
      // Normalize cache keys so cache-busting query params (e.g. ?v=...) don't create stale variants.
      return new Request(u.origin + u.pathname, { method: 'GET' });
    } catch (_) {
      return request;
    }
  }

  // Update widget code aggressively (avoid having to clear SW cache during development).
  // Still provides offline fallback from the SW cache.
  if (url.pathname === '/chat/widget/chat-widget.js' || url.pathname.endsWith('/chat/widget/chat-widget.js')) {
    event.respondWith((async () => {
      try {
        const resp = await fetch(new Request(request, { cache: 'no-store' }));
        if (resp && resp.ok) {
          try {
            const cache = await caches.open(CACHES.DYNAMIC);
            await cache.put(request, resp.clone());
          } catch (_) {}
        }
        return resp;
      } catch (_) {
        try {
          const cache = await caches.open(CACHES.DYNAMIC);
          const cached = await cache.match(request);
          if (cached) return cached;
        } catch (_) {}
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  // Update admin panel JS aggressively as well (served under /chat/admin and commonly cache-busted).
  if (url.pathname === '/chat/admin/panel.js' || url.pathname.endsWith('/chat/admin/panel.js')) {
    event.respondWith((async () => {
      const key = cacheKeyWithoutSearch(url);
      try {
        const resp = await fetch(new Request(request, { cache: 'no-store' }));
        if (resp && resp.ok) {
          try {
            const cache = await caches.open(CACHES.DYNAMIC);
            await cache.put(key, resp.clone());
          } catch (_) {}
        }
        return resp;
      } catch (_) {
        try {
          const cache = await caches.open(CACHES.DYNAMIC);
          const cached = await cache.match(key);
          if (cached) return cached;
        } catch (_) {}
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  // Allow caching chat widget static assets (JS/CSS) served from the reverse proxy.
  if (url.pathname.startsWith('/chat/widget/')) {
    event.respondWith(cacheFirst(request, CACHES.DYNAMIC));
    return;
  }

  // For the remaining /chat/* (admin UI HTML/JS, host page, etc.), prefer network to avoid stale UI.
  if (url.pathname.startsWith('/chat/')) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })).catch(() => networkFirstWithCache(request, CACHES.DYNAMIC)));
    return;
  }

  // Sidebar is loaded dynamically; keep it fresh to avoid stale navigation behavior.
  // Network-first + cache fallback (offline) with a normalized cache key.
  if (url.pathname === '/components/sidebar.html' || url.pathname.endsWith('/components/sidebar.html')) {
    event.respondWith((async () => {
      const key = cacheKeyWithoutSearch(url);
      try {
        const resp = await fetch(new Request(request, { cache: 'no-store' }));
        if (resp && resp.ok) {
          try {
            const cache = await caches.open(CACHES.DYNAMIC);
            await cache.put(key, resp.clone());
          } catch (_) {}
        }
        return resp;
      } catch (_) {
        try {
          const cache = await caches.open(CACHES.DYNAMIC);
          const cached = await cache.match(key);
          if (cached) return cached;
        } catch (_) {}
        return networkFirstWithCache(request, CACHES.DYNAMIC);
      }
    })());
    return;
  }

  // Bypass cache for admin question form to avoid stale validation/save logic
  if (url.pathname === '/pages/admin/questionForm.html') {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })).catch(() => networkFirstWithCache(request, CACHES.DYNAMIC)));
    return;
  }

  // Estratégia 1: Cache-First para assets estáticos
  if (STATIC_ASSETS.some(asset => url.pathname === asset || url.pathname.endsWith(asset))) {
    event.respondWith(cacheFirst(request, CACHES.STATIC));
    return;
  }

  // Estratégia 2: Network-First com Cache Fallback para API
  // IMPORTANT: do not cache AI endpoints (highly dynamic + used for debugging timeouts)
  if (url.pathname.startsWith('/api/ai/')) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCache(request, CACHES.API));
    return;
  }

  // Estratégia 3: Stale-While-Revalidate para imagens
  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request, CACHES.IMAGES));
    return;
  }

  // Estratégia 4: Network-First para páginas HTML
  if (request.headers.get('accept')?.includes('text/html')) {
    // Bypass cache for login routes to avoid blank page after logout
    const isLoginRoute = url.pathname === '/login' || url.pathname === '/login.html';
    if (isLoginRoute) {
      event.respondWith(fetch(new Request(request, { cache: 'no-store' })).catch(() => {
        return networkFirstWithCache(request, CACHES.DYNAMIC);
      }));
    } else {
      event.respondWith(networkFirstWithCache(request, CACHES.DYNAMIC));
    }
    return;
  }

  // Estratégia 5: Cache-First para outros recursos (CSS, JS, fonts)
  event.respondWith(cacheFirst(request, CACHES.DYNAMIC));
});

// ============================================
// Estratégia: Cache-First
// ============================================
async function cacheFirst(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    if (cached) {
      const dateHeader = cached.headers.get('sw-cache-time');
      if (dateHeader) {
        const age = Date.now() - parseInt(dateHeader);
        const maxAge = CACHE_CONFIG.maxAge[cacheName.split('-')[1]] || CACHE_CONFIG.maxAge.dynamic;
        
        if (age > maxAge) {
          fetchAndCache(request, cacheName).catch(() => {});
        }
      }
      return cached;
    }

    return await fetchAndCache(request, cacheName);
  } catch (error) {
    logger.info('[SW] Cache-first failed:', request.url);
    // Permitir que o navegador tente buscar normalmente
    return fetch(request).catch(() => {
      // Se tudo falhar, retornar resposta vazia ao invés de undefined
      return new Response('', { status: 404, statusText: 'Not Found' });
    });
  }
}

// ============================================
// Estratégia: Network-First com Cache Fallback
// ============================================
async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    
    if (response && response.ok) {
      try {
        const cache = await caches.open(cacheName);
        const responseToCache = response.clone();
        const headers = new Headers(responseToCache.headers);
        headers.set('sw-cache-time', Date.now().toString());

        // 204/205/304 cannot have a body; also guard against null body streams
        const nullBodyStatuses = new Set([204, 205, 304]);
        const body = (nullBodyStatuses.has(responseToCache.status) || responseToCache.body == null) ? null : responseToCache.body;

        const cachedResponse = new Response(body, {
          status: responseToCache.status,
          statusText: responseToCache.statusText,
          headers: headers
        });
        
        await cache.put(request, cachedResponse);
        cleanCache(cacheName).catch(() => {});
      } catch (cacheError) {
        logger.info('[SW] Cache put failed:', cacheError);
      }
    }
    
    return response;
  } catch (error) {
    logger.info('[SW] Network failed, trying cache:', request.url);
    
    try {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request);
      
      if (cached) return cached;
    } catch (cacheError) {
      logger.info('[SW] Cache match failed:', cacheError);
    }
    
    // Fallback para API
    if (request.url.includes('/api/')) {
      return new Response(
        JSON.stringify({ error: 'Você está offline', offline: true }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Para outros recursos, retornar 404
    return new Response('', { status: 404, statusText: 'Not Found' });
  }
}

// ============================================
// Estratégia: Stale-While-Revalidate
// ============================================
async function staleWhileRevalidate(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    const fetchPromise = fetch(request)
      .then(response => {
        if (response && response.ok) {
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      })
      .catch(() => {
        logger.info('[SW] Stale-while-revalidate fetch failed:', request.url);
        return cached || new Response('', { status: 404 });
      });
    
    return cached || fetchPromise;
  } catch (error) {
    logger.info('[SW] Stale-while-revalidate error:', error);
    return fetch(request).catch(() => new Response('', { status: 404 }));
  }
}

// ============================================
// Helpers
// ============================================
async function fetchAndCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    logger.info('[SW] Fetch failed for:', request.url);
    throw error;
  }
}

async function cleanCache(cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    const maxEntries = CACHE_CONFIG.maxEntries[cacheName.split('-')[1]] || 100;
    
    if (requests.length > maxEntries) {
      const toDelete = requests.slice(0, requests.length - maxEntries);
      await Promise.all(toDelete.map(request => cache.delete(request)));
      logger.info(`[SW] Cleaned ${toDelete.length} entries from ${cacheName}`);
    }
  } catch (error) {
    logger.info('[SW] Clean cache failed:', error);
  }
}

// ============================================
// BACKGROUND SYNC
// ============================================
self.addEventListener('sync', event => {
  logger.info('[SW] Background sync:', event.tag);
  if (event.tag === 'sync-answers') {
    event.waitUntil(syncAnswers());
  }
});

async function syncAnswers() {
  logger.info('[SW] Syncing answers...');
  // Delegado ao syncManager.js no client
}

// ============================================
// PUSH NOTIFICATIONS
// ============================================
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'Nova notificação',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    data: data
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'SimuladosBR', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});

// ============================================
// MENSAGENS do cliente
// ============================================
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    event.waitUntil(
      caches.open(CACHES.DYNAMIC).then(cache => cache.addAll(urls))
    );
  }
});

logger.info(`[SW v${VERSION}] Loaded and ready`);
