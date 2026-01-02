const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { env } = require('./config/env');
const { requestId } = require('./middleware/requestId');
const { errorHandler } = require('./middleware/errorHandler');
const { authOptional } = require('./middleware/authOptional');

const { healthRouter } = require('./routes/health');
const { conversationsRouter } = require('./routes/conversations');
const { adminRouter } = require('./routes/admin');
const path = require('path');

function buildCorsOptions() {
  const allowed = new Set(env.CORS_ORIGINS);

  return {
    origin(origin, callback) {
      // Non-browser clients (no Origin) are allowed.
      if (!origin) return callback(null, true);

      // Some contexts (file://, sandboxed iframes) send Origin: "null".
      // Allow it only in development (or if explicitly allowlisted).
      if (origin === 'null') {
        if (allowed.has('null') || String(env.NODE_ENV || '').toLowerCase() !== 'production') {
          return callback(null, true);
        }
      }

      // Allow same-origin requests (ex.: admin panel served by this service).
      // Browsers often send Origin even for same-origin fetches.
      // We infer possible origins from the Host header via a custom cors() options callback below.
      if (allowed.has(origin)) return callback(null, true);

      const err = new Error(`CORS blocked for origin: ${origin}`);
      err.status = 403;
      return callback(err);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Chat-Visitor-Id', 'X-Admin-Name'],
  };
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(requestId());

  // CORS allowlist for widget embeds + allow same-origin for the service itself.
  app.use(cors((req, callback) => {
    const opts = buildCorsOptions();
    const origin = String(req.headers.origin || '').trim();

    if (!origin) return callback(null, opts);

    const host = String(req.headers.host || '').trim();
    if (host) {
      const sameHttp = `http://${host}`;
      const sameHttps = `https://${host}`;
      if (origin === sameHttp || origin === sameHttps) {
        return callback(null, { ...opts, origin: true });
      }
    }

    return callback(null, opts);
  }));

  app.use(express.json({ limit: '64kb' }));

  app.use(rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }));

  // Chrome DevTools may probe this well-known path on localhost.
  // Return 204 to avoid noisy 404 logs.
  app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.status(204).end();
  });

  app.get('/health', healthRouter);

  // Widget JS served from this service
  app.use('/widget', express.static(path.join(__dirname, '..', 'widget'), {
    fallthrough: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }));

  // Admin panel (static)
  app.use('/admin', express.static(path.join(__dirname, '..', 'admin'), {
    fallthrough: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }));

  app.use('/v1/admin', adminRouter);
  app.use(authOptional());
  app.use('/v1', conversationsRouter);

  app.use(errorHandler());

  return app;
}

module.exports = { createApp };
