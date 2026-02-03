import crypto from 'node:crypto';
import { promisify } from 'node:util';

import { getPool } from './pool.js';
import { config } from '../shared/config.js';

const scryptAsync = promisify(crypto.scrypt);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export async function hasAdminAuthTables() {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       to_regclass('public.admin_users') is not null as users_ok,
       to_regclass('public.admin_sessions') is not null as sessions_ok`
  );
  return !!rows?.[0]?.users_ok && !!rows?.[0]?.sessions_ok;
}

export async function hashPassword(password) {
  const pwd = String(password || '');
  if (pwd.length < 8) throw new Error('PASSWORD_TOO_SHORT');

  const salt = crypto.randomBytes(16).toString('base64');
  const key = await scryptAsync(pwd, salt, 64);
  const hash = Buffer.from(key).toString('base64');
  return `scrypt$${salt}$${hash}`;
}

export async function verifyPassword(password, encodedHash) {
  const pwd = String(password || '');
  const enc = String(encodedHash || '');

  const parts = enc.split('$');
  if (parts.length !== 3) return false;
  if (parts[0] !== 'scrypt') return false;

  const salt = parts[1];
  const expected = parts[2];

  const key = await scryptAsync(pwd, salt, 64);
  const actualB64 = Buffer.from(key).toString('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(actualB64), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function createAdminUser({ email, password, role = 'admin', isActive = true }) {
  const ok = await hasAdminAuthTables();
  if (!ok) throw new Error('ADMIN_AUTH_SCHEMA_MISSING');

  const e = normalizeEmail(email);
  if (!e) throw new Error('EMAIL_REQUIRED');

  const passwordHash = await hashPassword(password);

  const pool = getPool();
  const { rows } = await pool.query(
    `insert into admin_users (email, password_hash, role, is_active)
     values ($1, $2, $3, $4)
     on conflict (email) do update set
       password_hash = excluded.password_hash,
       role = excluded.role,
       is_active = excluded.is_active
     returning id, email, role, is_active, created_at, last_login_at`,
    [e, passwordHash, String(role || 'admin'), !!isActive]
  );

  return rows[0] ?? null;
}

export async function findActiveAdminUserByEmail(email) {
  const ok = await hasAdminAuthTables();
  if (!ok) return null;

  const e = normalizeEmail(email);
  if (!e) return null;

  const pool = getPool();
  const { rows } = await pool.query(
    `select id, email, password_hash, role, is_active, created_at, last_login_at
     from admin_users
     where email = $1
     limit 1`,
    [e]
  );

  const row = rows[0] ?? null;
  if (!row || !row.is_active) return null;
  return row;
}

export async function authenticateAdminUser({ email, password }) {
  const user = await findActiveAdminUserByEmail(email);
  if (!user) return { ok: false, reason: 'INVALID_CREDENTIALS' };

  const passOk = await verifyPassword(password, user.password_hash);
  if (!passOk) return { ok: false, reason: 'INVALID_CREDENTIALS' };

  const pool = getPool();
  await pool.query(`update admin_users set last_login_at = now() where id = $1`, [user.id]);

  return { ok: true, user: { id: user.id, email: user.email, role: user.role } };
}

export function hashSessionToken(token) {
  return sha256Hex(String(token || ''));
}

export function getAdminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    path: '/' // used by /admin/*
  };
}

export async function ensureBootstrapAdminUserIfConfigured() {
  const ok = await hasAdminAuthTables();
  if (!ok) return { ok: false, skipped: true, reason: 'ADMIN_AUTH_SCHEMA_MISSING' };

  const email = normalizeEmail(process.env.ADMIN_BOOTSTRAP_EMAIL);
  const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '');

  if (!email || !password) return { ok: false, skipped: true, reason: 'NO_BOOTSTRAP_ENV' };

  const pool = getPool();
  const { rows } = await pool.query(`select count(*)::int as n from admin_users`);
  const n = rows?.[0]?.n ?? 0;
  if (n > 0) return { ok: true, skipped: true, reason: 'USERS_ALREADY_EXIST' };

  const created = await createAdminUser({ email, password, role: 'admin', isActive: true });
  return { ok: true, created: created ? { id: created.id, email: created.email } : null };
}
