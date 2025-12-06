// Service Worker v2.0 - PWA Offline-First Robusto
// Estratégias: Cache-First (assets), Network-First + Cache Fallback (API), Stale-While-Revalidate (images)

const VERSION = '2.0.0';
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
  console.log(`[SW v${VERSION}] Installing...`);
  
  event.waitUntil(
    caches.open(CACHES.STATIC)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      })
      .then(() => {
        console.log('[SW] Static assets cached, skipping waiting');
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Install failed:', err);
        return Promise.reject(err);
      })
  );
});

// ============================================
// ACTIVATE
// ============================================
self.addEventListener('activate', event => {
  console.log(`[SW v${VERSION}] Activating...`);
  
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
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      }),
      self.clients.claim()
    ]).then(() => {
      console.log('[SW] Activation complete, controlling all clients');
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

  // Estratégia 1: Cache-First para assets estáticos
  if (STATIC_ASSETS.some(asset => url.pathname === asset || url.pathname.endsWith(asset))) {
    event.respondWith(cacheFirst(request, CACHES.STATIC));
    return;
  }

  // Estratégia 2: Network-First com Cache Fallback para API
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
    event.respondWith(networkFirstWithCache(request, CACHES.DYNAMIC));
    return;
  }

  // Estratégia 5: Cache-First para outros recursos (CSS, JS, fonts)
  event.respondWith(cacheFirst(request, CACHES.DYNAMIC));
});

// ============================================
// Estratégia: Cache-First
// ============================================
async function cacheFirst(request, cacheName) {
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

  return fetchAndCache(request, cacheName);
}

// ============================================
// Estratégia: Network-First com Cache Fallback
// ============================================
async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const cache = await caches.open(cacheName);
      const responseToCache = response.clone();
      const headers = new Headers(responseToCache.headers);
      headers.set('sw-cache-time', Date.now().toString());
      
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers
      });
      
      cache.put(request, cachedResponse);
      cleanCache(cacheName);
    }
    
    return response;
  } catch (error) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    if (cached) return cached;
    
    if (request.url.includes('/api/')) {
      return new Response(
        JSON.stringify({ error: 'Você está offline', offline: true }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    return Response.error();
  }
}

// ============================================
// Estratégia: Stale-While-Revalidate
// ============================================
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  
  return cached || fetchPromise;
}

// ============================================
// Helpers
// ============================================
async function fetchAndCache(request, cacheName) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function cleanCache(cacheName) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  const maxEntries = CACHE_CONFIG.maxEntries[cacheName.split('-')[1]] || 100;
  
  if (requests.length > maxEntries) {
    const toDelete = requests.slice(0, requests.length - maxEntries);
    await Promise.all(toDelete.map(request => cache.delete(request)));
  }
}

// ============================================
// BACKGROUND SYNC
// ============================================
self.addEventListener('sync', event => {
  console.log('[SW] Background sync:', event.tag);
  if (event.tag === 'sync-answers') {
    event.waitUntil(syncAnswers());
  }
});

async function syncAnswers() {
  console.log('[SW] Syncing answers...');
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

console.log(`[SW v${VERSION}] Loaded and ready`);
