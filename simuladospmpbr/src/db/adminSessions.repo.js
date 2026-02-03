import crypto from 'node:crypto';

import { getPool } from './pool.js';
import { hashSessionToken, hasAdminAuthTables } from './adminUsers.repo.js';

export function generateSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function pickHeader(req, key) {
  const v = req?.headers?.[key];
  if (!v) return null;
  if (Array.isArray(v)) return v.join(',');
  return String(v);
}

export async function createAdminSession({ userId, token, ttlDays = 14, ip = null, userAgent = null }) {
  const ok = await hasAdminAuthTables();
  if (!ok) throw new Error('ADMIN_AUTH_SCHEMA_MISSING');

  const t = String(token || '');
  if (!t) throw new Error('TOKEN_REQUIRED');

  const tokenHash = hashSessionToken(t);
  const expiresAt = new Date(Date.now() + Number(ttlDays) * 24 * 60 * 60 * 1000).toISOString();

  const pool = getPool();
  const { rows } = await pool.query(
    `insert into admin_sessions (user_id, token_hash, expires_at, ip, user_agent)
     values ($1, $2, $3::timestamptz, $4, $5)
     returning id, user_id, expires_at, revoked_at, created_at`,
    [String(userId), tokenHash, expiresAt, ip, userAgent]
  );

  return { session: rows[0] ?? null, expiresAt };
}

export async function revokeAdminSessionByToken({ token }) {
  const ok = await hasAdminAuthTables();
  if (!ok) return { ok: false, skipped: true, reason: 'ADMIN_AUTH_SCHEMA_MISSING' };

  const t = String(token || '');
  if (!t) return { ok: false, skipped: true, reason: 'NO_TOKEN' };

  const tokenHash = hashSessionToken(t);
  const pool = getPool();
  await pool.query(
    `update admin_sessions
     set revoked_at = now()
     where token_hash = $1 and revoked_at is null`,
    [tokenHash]
  );

  return { ok: true };
}

export async function getAdminUserBySessionToken({ token }) {
  const ok = await hasAdminAuthTables();
  if (!ok) return null;

  const t = String(token || '');
  if (!t) return null;

  const tokenHash = hashSessionToken(t);
  const pool = getPool();
  const { rows } = await pool.query(
    `select
        u.id as user_id,
        u.email as email,
        u.role as role,
        u.is_active as is_active,
        s.expires_at as expires_at,
        s.revoked_at as revoked_at
     from admin_sessions s
     join admin_users u on u.id = s.user_id
     where s.token_hash = $1
       and s.revoked_at is null
       and s.expires_at > now()
     limit 1`,
    [tokenHash]
  );

  const row = rows[0] ?? null;
  if (!row || !row.is_active) return null;

  return {
    id: row.user_id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at
  };
}

export function getClientIp(req) {
  const xf = pickHeader(req, 'x-forwarded-for');
  if (xf && xf.trim()) return xf.split(',')[0].trim();
  const xr = pickHeader(req, 'x-real-ip');
  if (xr && xr.trim()) return xr.trim();
  return req?.ip || null;
}

export function getUserAgent(req) {
  return pickHeader(req, 'user-agent');
}
