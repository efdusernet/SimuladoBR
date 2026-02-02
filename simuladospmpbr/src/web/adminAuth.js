import { config } from '../shared/config.js';

function unauthorized(res) {
  res.set('WWW-Authenticate', 'Basic realm="Finance Admin"');
  return res.status(401).send('Unauthorized');
}

function parseBasicAuth(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const m = headerValue.match(/^Basic\s+(.+)$/i);
  if (!m) return null;

  try {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return {
      username: decoded.slice(0, idx),
      password: decoded.slice(idx + 1)
    };
  } catch {
    return null;
  }
}

function isConfigured() {
  return !!(config.adminBasicAuth || config.adminPassword);
}

function getBasicAuthCredsIfAllowed(req) {
  const creds = parseBasicAuth(req.headers.authorization);
  if (!creds) return null;

  if (config.adminBasicAuth) {
    // Expected format: user:pass
    const idx = String(config.adminBasicAuth).indexOf(':');
    if (idx < 0) return null;
    const user = String(config.adminBasicAuth).slice(0, idx);
    const pass = String(config.adminBasicAuth).slice(idx + 1);
    if (creds.username === user && creds.password === pass) return creds;
    return null;
  }

  const expectedUser = config.adminUser || 'admin';
  const expectedPass = config.adminPassword || '';
  if (creds.username === expectedUser && creds.password === expectedPass) return creds;
  return null;
}

export function requireAdminBasicAuth(req, res, next) {
  // In dev, allow bootstrapping without env vars.
  if (!isConfigured()) {
    if (config.nodeEnv !== 'production') return next();
    return unauthorized(res);
  }

  const creds = getBasicAuthCredsIfAllowed(req);
  if (!creds) {
    return unauthorized(res);
  }

  // Expose to downstream handlers for audit logs.
  req.adminUser = creds.username;

  return next();
}
