const { WebSocketServer } = require('ws');
const { URL } = require('url');

const { env } = require('../config/env');
const { adminEvents } = require('./adminEvents');
const { authenticateAdminToken } = require('../middleware/adminAuth');

const WS_PATH = '/v1/admin/ws';
const WS_PATH_ALT = '/chat/v1/admin/ws';

function isAllowedWsOrigin(origin, host) {
  const o = String(origin || '').trim();
  if (!o) return true; // non-browser clients

  const allowed = new Set(Array.isArray(env.CORS_ORIGINS) ? env.CORS_ORIGINS : []);

  // Some contexts (file://, sandboxed iframes) send Origin: "null".
  if (o === 'null') {
    if (allowed.has('null') || String(env.NODE_ENV || '').toLowerCase() !== 'production') return true;
    return false;
  }

  const h = String(host || '').trim();
  if (h) {
    if (o === `http://${h}` || o === `https://${h}`) return true;
  }

  return allowed.has(o);
}

function safeJsonParse(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function attachAdminWebSocketServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  /** @type {Set<{ws:any, authed:boolean, admin:any}>} */
  const clients = new Set();

  function broadcastRefresh(evt) {
    const payload = {
      type: 'refresh',
      ts: evt && evt.ts ? evt.ts : Date.now(),
      reason: evt && evt.reason ? String(evt.reason) : 'unknown',
      conversationId: evt && evt.conversationId ? String(evt.conversationId) : null,
    };

    const msg = JSON.stringify(payload);
    for (const c of clients) {
      if (!c.authed) continue;
      if (!c.ws || c.ws.readyState !== c.ws.OPEN) continue;
      try { c.ws.send(msg); } catch {}
    }
  }

  adminEvents.on('refresh', broadcastRefresh);

  server.on('upgrade', (req, socket, head) => {
    try {
      const host = String(req.headers.host || '').trim();
      const url = new URL(String(req.url || ''), `http://${host || 'localhost'}`);
      if (url.pathname !== WS_PATH && url.pathname !== WS_PATH_ALT) return;

      const origin = String(req.headers.origin || '').trim();
      if (!isAllowedWsOrigin(origin, host)) {
        try { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); } catch {}
        try { socket.destroy(); } catch {}
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      try { socket.destroy(); } catch {}
    }
  });

  wss.on('connection', (ws) => {
    const client = { ws, authed: false, admin: null };
    clients.add(client);

    let authTimeout = null;
    try {
      authTimeout = setTimeout(() => {
        try { ws.close(4401, 'auth required'); } catch {}
      }, 8000);
    } catch {}

    let pingTimer = null;
    try {
      pingTimer = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return;
        try { ws.ping(); } catch {}
      }, 30000);
    } catch {}

    ws.on('close', () => {
      clients.delete(client);
      if (authTimeout) {
        try { clearTimeout(authTimeout); } catch {}
        authTimeout = null;
      }
      if (pingTimer) {
        try { clearInterval(pingTimer); } catch {}
        pingTimer = null;
      }
    });

    ws.on('message', async (data) => {
      const raw = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
      const msg = safeJsonParse(raw);
      if (!msg) return;

      if (msg.type === 'auth') {
        const token = msg.token != null ? String(msg.token).trim() : '';
        const headerName = msg.name != null ? String(msg.name).trim() : '';

        try {
          const admin = await authenticateAdminToken({ token, headerName });
          client.authed = true;
          client.admin = admin;

          if (authTimeout) {
            try { clearTimeout(authTimeout); } catch {}
            authTimeout = null;
          }

          const role = admin && admin.role ? String(admin.role) : (admin && admin.id ? 'attendant' : 'root');
          const isRoot = role === 'root';

          ws.send(JSON.stringify({
            type: 'auth_ok',
            me: {
              id: admin && admin.id ? String(admin.id) : null,
              name: admin && admin.name ? String(admin.name) : 'Root',
              role,
              isRoot,
            },
          }));
        } catch (err) {
          const status = err && err.status ? Number(err.status) : 401;
          const errorMsg = err && err.message ? String(err.message) : 'Admin não autorizado';
          try {
            ws.send(JSON.stringify({ type: 'auth_error', status, error: errorMsg }));
          } catch {}
          try { ws.close(4401, 'unauthorized'); } catch {}
        }
      }
    });

    // Tell client where we are (useful for debugging without changing UI).
    try {
      ws.send(JSON.stringify({ type: 'hello', path: WS_PATH, altPath: WS_PATH_ALT }));
    } catch {}
  });

  return {
    wss,
    close() {
      adminEvents.off('refresh', broadcastRefresh);
      try { wss.close(); } catch {}
    },
  };
}

module.exports = { attachAdminWebSocketServer, WS_PATH, WS_PATH_ALT };
