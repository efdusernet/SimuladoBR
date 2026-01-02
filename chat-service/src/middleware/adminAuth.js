const { env } = require('../config/env');
const { hashAdminToken } = require('../services/adminTokens');
const { adminUsersStore } = require('../store/adminUsersStore');

async function authenticateAdminToken({ token, headerName }) {
  const expectedSingle = String(env.ADMIN_TOKEN || '').trim();
  const expectedNamed = Array.isArray(env.ADMIN_TOKENS) ? env.ADMIN_TOKENS : [];

  const t = String(token || '').trim();
  if (!t) {
    const e = new Error('Admin não autorizado');
    e.status = 401;
    throw e;
  }

  const named = expectedNamed.find((x) => String(x.token) === t);
  if (named) {
    return { name: String(named.name), token: t, role: 'root' };
  }

  if (expectedSingle && t === expectedSingle) {
    const n = String(headerName || '').trim();
    return { name: n || 'Root', token: t, role: 'root' };
  }

  // DB-backed attendants
  try {
    const tokenHash = hashAdminToken(t);
    const adminUser = await adminUsersStore.getActiveByTokenHash(tokenHash);
    if (adminUser) {
      // If the token was issued as an invite, it may expire.
      // Once used successfully (first login), we clear the expiry (token becomes permanent).
      if (adminUser.token_expires_at) {
        const expMs = Date.parse(String(adminUser.token_expires_at));
        if (Number.isFinite(expMs) && Date.now() > expMs) {
          const e = new Error('Token expirado. Solicite um novo convite.');
          e.status = 401;
          throw e;
        }

        // Best-effort: clear expiry on first successful use.
        try {
          await adminUsersStore.clearTokenExpiry(String(adminUser.id));
        } catch {}
      }

      return {
        id: adminUser.id,
        name: String(adminUser.name),
        role: String(adminUser.role || 'attendant'),
        token: t,
      };
    }
  } catch (err) {
    // If DB is down/migration missing, and there are no bootstrap tokens,
    // signal misconfiguration.
    if (!expectedSingle && expectedNamed.length === 0) {
      const e = new Error('Admin não configurado (ADMIN_TOKEN / admin_users)');
      e.status = 503;
      e.cause = err;
      throw e;
    }

    // Otherwise, fail closed.
    const e = new Error('Admin não autorizado');
    e.status = 401;
    e.cause = err;
    throw e;
  }

  const e = new Error('Admin não autorizado');
  e.status = 401;
  throw e;
}

function adminAuth() {
  return async function adminAuthMiddleware(req, res, next) {
    const raw = String(req.headers.authorization || '').trim();
    const token = raw && /^Bearer\s+/i.test(raw) ? raw.replace(/^Bearer\s+/i, '').trim() : '';

    try {
      const headerName = String(req.headers['x-admin-name'] || '').trim();
      req.admin = await authenticateAdminToken({ token, headerName });
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { adminAuth, authenticateAdminToken };
