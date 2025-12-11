const crypto = require('crypto');
const { security } = require('../utils/logger');

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
                          req.body._csrf || 
                          req.query._csrf;
  
  // Get token from cookie
  const tokenFromCookie = req.cookies.csrfToken;

  // Validate token exists
  if (!tokenFromRequest || !tokenFromCookie) {
    security.csrfFailure(req);
    return res.status(403).json({ 
      error: 'CSRF token missing',
      code: 'CSRF_MISSING'
    });
  }

  // Validate tokens match
  if (tokenFromRequest !== tokenFromCookie) {
    security.csrfFailure(req);
    return res.status(403).json({ 
      error: 'CSRF token invalid',
      code: 'CSRF_INVALID'
    });
  }

  // Validate token in store and not expired
  const tokenData = tokenStore.get(tokenFromCookie);
  if (!tokenData) {
    security.csrfFailure(req);
    return res.status(403).json({ 
      error: 'CSRF token expired or invalid',
      code: 'CSRF_EXPIRED'
    });
  }

  // Check expiration
  if (Date.now() - tokenData.createdAt > TOKEN_EXPIRY) {
    tokenStore.delete(tokenFromCookie);
    security.csrfFailure(req);
    return res.status(403).json({ 
      error: 'CSRF token expired',
      code: 'CSRF_EXPIRED'
    });
  }

  // Validate origin/referer for additional security
  const origin = req.headers.origin || req.headers.referer;
  const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  if (origin && !origin.startsWith(allowedOrigin)) {
    security.csrfFailure(req);
    security.suspiciousActivity(req, `CSRF origin mismatch: ${origin}`);
    return res.status(403).json({ 
      error: 'Invalid origin',
      code: 'CSRF_ORIGIN_MISMATCH'
    });
  }

  next();
}

// Generate new token for a session
function generateCsrfToken(req, res) {
  const token = generateToken();
  
  // Store token with metadata
  tokenStore.set(token, {
    createdAt: Date.now(),
    sessionId: req.cookies.sessionToken || 'anonymous'
  });

  // Set cookie with token
  res.cookie('csrfToken', token, {
    httpOnly: false, // Must be accessible to JavaScript for header inclusion
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
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
