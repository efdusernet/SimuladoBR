const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../models');
const { jwtSecret } = require('../config/security');

function isJwtLike(token) {
  return /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(String(token || '').trim());
}

function extractTokenFromRequest(req) {
  const authHeader = (req.headers && req.headers.authorization) ? String(req.headers.authorization).trim() : '';
  const bearer = /^Bearer\s+/i.test(authHeader) ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';

  let token = (
    (req.cookies && req.cookies.sessionToken) ||
    (req.get && req.get('X-Session-Token')) ||
    (req.body && req.body.sessionToken) ||
    (req.query && (req.query.sessionToken || req.query.session || req.query.token)) ||
    ''
  ).toString().trim();

  // If a Bearer token is present, prefer it.
  // This prevents an invalid/non-JWT X-Session-Token from shadowing a valid JWT.
  if (bearer) {
    if (!token) return bearer;
    if (!isJwtLike(token) && isJwtLike(bearer)) return bearer;
    // If both exist, keep Bearer as the source of truth.
    return bearer;
  }

  return token;
}

function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

async function upsertActiveSession(userId, sessionId) {
  if (!db.UserActiveSession) throw new Error('UserActiveSession model not registered');
  const now = new Date();
  await db.UserActiveSession.upsert({
    UserId: Number(userId),
    SessionId: String(sessionId),
    IssuedAt: now,
    UpdatedAt: now,
  });
}

async function clearActiveSession(userId, sessionId) {
  if (!db.UserActiveSession) return;
  const where = { UserId: Number(userId) };
  if (sessionId) where.SessionId = String(sessionId);
  await db.UserActiveSession.destroy({ where });
}

async function verifyJwtAndGetActiveUser(token) {
  const raw = String(token || '').trim();
  if (!raw) return { ok: false, status: 401, code: 'SESSION_TOKEN_REQUIRED', message: 'Session token required' };
  if (!isJwtLike(raw)) return { ok: false, status: 401, code: 'JWT_REQUIRED', message: 'JWT required' };

  let decoded;
  try {
    decoded = jwt.verify(raw, jwtSecret);
  } catch (e) {
    const name = String(e && e.name || '').trim();
    if (name === 'TokenExpiredError') {
      return { ok: false, status: 401, code: 'TOKEN_EXPIRED', message: 'Sessão expirada. Faça login novamente.' };
    }
    if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
      return { ok: false, status: 401, code: 'INVALID_TOKEN', message: 'Token inválido' };
    }
    return { ok: false, status: 401, code: 'INVALID_TOKEN', message: 'Token inválido' };
  }

  const userId = decoded && decoded.sub ? Number(decoded.sub) : 0;
  const sid = decoded && decoded.sid ? String(decoded.sid) : '';
  if (!userId) return { ok: false, status: 401, code: 'INVALID_TOKEN_PAYLOAD', message: 'Token inválido' };
  if (!sid) return { ok: false, status: 401, code: 'SESSION_SID_MISSING', message: 'Sessão desatualizada. Faça login novamente.' };

  const active = await db.UserActiveSession.findOne({ where: { UserId: userId } });
  if (!active) return { ok: false, status: 401, code: 'SESSION_NOT_FOUND', message: 'Sessão expirada. Faça login novamente.' };
  if (String(active.SessionId) !== sid) {
    return { ok: false, status: 401, code: 'SESSION_REVOKED', message: 'Sua sessão foi encerrada porque houve um novo login. Faça login novamente.' };
  }

  const user = await db.User.findByPk(userId);
  if (!user) return { ok: false, status: 401, code: 'USER_NOT_FOUND', message: 'User not found' };

  return { ok: true, user, decoded };
}

module.exports = {
  isJwtLike,
  extractTokenFromRequest,
  generateSessionId,
  upsertActiveSession,
  clearActiveSession,
  verifyJwtAndGetActiveUser,
};
