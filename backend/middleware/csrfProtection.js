const crypto = require('crypto');
const { security } = require('../utils/logger');
const { forbidden } = require('./errors');

// In-memory token store (in production, use Redis)
const tokenStore = new Map();
const TOKEN_EXPIRY = 3600000; // 1 hour in milliseconds

/**
 * Modern CSRF protection middleware
 * Implements Double Submit Cookie pattern with additional security
 */

// Generate a secure CSRF token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Middleware to generate and attach CSRF token
function csrfProtection(req, res, next) {
  // Skip CSRF for GET, HEAD, OPTIONS (safe methods)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Get token from header or body
  const tokenFromRequest = req.headers['x-csrf-token'] || 
                          (req.body && req.body._csrf) || 
                          (req.query && req.query._csrf);
  
  // Get token from cookie
  const tokenFromCookie = req.cookies && req.cookies.csrfToken;

  // Validate token exists
  if (!tokenFromRequest || !tokenFromCookie) {
    security.csrfFailure(req);
    try {
      console.warn('[CSRF] Missing token', {
        path: req.path,
        method: req.method,
        hasHeader: !!tokenFromRequest,
        hasCookie: !!tokenFromCookie,
        origin: req.headers.origin,
        referer: req.headers.referer
      });
    } catch(_) {}
    return next(forbidden('CSRF token missing', 'CSRF_MISSING'));
  }

  // Validate tokens match
  if (tokenFromRequest !== tokenFromCookie) {
    security.csrfFailure(req);
    try {
      console.warn('[CSRF] Token mismatch', {
        path: req.path,
        method: req.method,
        headerLen: String(tokenFromRequest||'').length,
        cookieLen: String(tokenFromCookie||'').length
      });
    } catch(_) {}
    return next(forbidden('CSRF token invalid', 'CSRF_INVALID'));
  }

  // Validate token in store and not expired
  let tokenData = tokenStore.get(tokenFromCookie);
  if (!tokenData) {
    // In-memory stores are volatile (server restart, hot-reload, multi-process).
    // If the client presents a valid double-submit token (header == cookie),
    // we can safely accept it and rehydrate the store entry.
    try { console.warn('[CSRF] Token not in store; rehydrating', { path: req.path, method: req.method }); } catch(_) {}
    tokenData = {
      createdAt: Date.now(),
      sessionId: req.cookies.sessionToken || 'anonymous'
    };
    tokenStore.set(tokenFromCookie, tokenData);
  }

  // Check expiration
  if (!tokenData || (Date.now() - tokenData.createdAt > TOKEN_EXPIRY)) {
    tokenStore.delete(tokenFromCookie);
    security.csrfFailure(req);
    try { console.warn('[CSRF] Token expired', { path: req.path, method: req.method }); } catch(_) {}
    return next(forbidden('CSRF token expired', 'CSRF_EXPIRED'));
  }

  // Validate origin/referer for additional security (relaxed for localhost and file:// testing)
  const origin = req.headers.origin || req.headers.referer;
  const allowedOrigin = process.env.FRONTEND_URL || 'http://app.localhost:3000';
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const isNullOrigin = String(origin || '').trim().toLowerCase() === 'null';
  const isLocalhost = (o) => {
    try {
      const u = new URL(o);
      const h = (u.hostname || '').toLowerCase();
      // Treat *.localhost as local loopback (common dev pattern: app.localhost, api.localhost)
      return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1';
    } catch (_) {
      return false;
    }
  };
  const isAllowed = (
    !origin ||
    origin.startsWith(allowedOrigin) ||
    origin.startsWith('file://') ||
    (!isProd && isNullOrigin) ||
    isLocalhost(origin) // allow any localhost port for development
  );
  if (!isAllowed) {
    security.csrfFailure(req);
    security.suspiciousActivity(req, `CSRF origin mismatch: ${origin}`);
    try { console.warn('[CSRF] Origin mismatch', { origin, referer: req.headers.referer }); } catch(_) {}
    return next(forbidden('Invalid origin', 'CSRF_ORIGIN_MISMATCH'));
  }

  next();
}

// Generate new token for a session
function generateCsrfToken(req, res) {
  const token = generateToken();
  
  // Store token with metadata
  tokenStore.set(token, {
    createdAt: Date.now(),
    sessionId: (req.cookies && req.cookies.sessionToken) || 'anonymous'
  });

  // Set cookie with token
  const isHttps = !!(req.secure || (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'].toLowerCase() === 'https'));
  // Use SameSite 'lax' during local development or non-HTTP origins to allow token on cross-origin navigations (file:// → http://localhost)
  let sameSite = 'strict';
  try {
    const origin = req.headers.origin || req.headers.referer || '';
    const isHttpOrigin = /^https?:/i.test(origin);
    const host = isHttpOrigin ? new URL(origin).hostname : '';
    const h = String(host || '').toLowerCase();
    const isLocal = h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1';
    if (!isHttpOrigin || isLocal) {
      sameSite = 'lax';
    }
  } catch(_) { /* keep default */ }

  res.cookie('csrfToken', token, {
    httpOnly: false,
    secure: isHttps,
    sameSite,
    maxAge: TOKEN_EXPIRY
  });

  return token;
}

// Cleanup expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of tokenStore.entries()) {
    if (now - data.createdAt > TOKEN_EXPIRY) {
      tokenStore.delete(token);
    }
  }
}, 300000); // Cleanup every 5 minutes

// Helper to add token to request object
function attachCsrfToken(req, res, next) {
  req.csrfToken = () => {
    // Reuse existing token if valid
    const existingToken = req.cookies.csrfToken;
    if (existingToken && tokenStore.has(existingToken)) {
      const tokenData = tokenStore.get(existingToken);
      if (Date.now() - tokenData.createdAt < TOKEN_EXPIRY) {
        return existingToken;
      }
    }
    
    // Generate new token
    return generateCsrfToken(req, res);
  };
  next();
}

module.exports = {
  csrfProtection,
  attachCsrfToken,
  generateCsrfToken
};
