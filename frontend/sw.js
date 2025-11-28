// Service Worker - SimuladosBR
// Estratégia: Cache-first para assets estáticos, Network-first para API

const CACHE_NAME = 'simuladosbr-v1.1.0';
const STATIC_CACHE = 'simuladosbr-static-v1.1.0';
const API_CACHE = 'simuladosbr-api-v1.1.0';

// Assets críticos para cache inicial
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/styles.css',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/pmi.png'
];

// Install: cache assets estáticos
self.addEventListener('install', event => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

// Activate: limpa caches antigos
self.addEventListener('activate', event => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => {
              return name.startsWith('simuladosbr-') && 
                     name !== STATIC_CACHE && 
                     name !== API_CACHE;
            })
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: estratégia híbrida
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora esquemas não http/https (ex.: chrome-extension:, data:, blob:)
  if (!/^https?:/.test(request.url)) {
    return; // deixa o navegador tratar normalmente
  }

  // API requests: Network-first (sempre buscar dados frescos)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok && request.method === 'GET') {
            try {
              const responseClone = response.clone();
              caches.open(API_CACHE).then(cache => {
                cache.put(request, responseClone).catch(err => console.warn('[SW] cache.put API falhou:', err));
              });
            } catch (err) {
              console.warn('[SW] Falha ao cachear API:', err);
            }
          }
          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then(cached => cached || new Response(
              JSON.stringify({ error: 'Sem conexão' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            ));
        })
    );
    return;
  }

  // Assets estáticos: Cache-first
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) {
          return cached;
        }
        return fetch(request)
          .then(response => {
            if (response.ok && request.method === 'GET') {
              try {
                const responseClone = response.clone();
                caches.open(STATIC_CACHE).then(cache => {
                  cache.put(request, responseClone).catch(err => console.warn('[SW] cache.put STATIC falhou:', err));
                });
              } catch (err) {
                console.warn('[SW] Falha ao cachear STATIC:', err);
              }
            }
            return response;
          })
          .catch(err => {
            console.error('[SW] Fetch failed:', err);
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            return new Response('', { status: 404 });
          });
      })
  );
});

// Mensagens do cliente (para forçar update, limpar cache, etc.)
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    event.waitUntil(
      caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
    );
  }
});

// Push notifications (quando implementado)
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'SimuladosBR';
  const options = {
    body: data.body || 'Nova notificação',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    data: data.url || '/'
  };
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || '/')
  );
});

console.log('[SW] Service Worker loaded');
