const { query } = require('../db/pool');

function addDays(d, days) {
  const t = d instanceof Date ? d.getTime() : Date.now();
  return new Date(t + Number(days) * 24 * 60 * 60 * 1000);
}

const adminUsersStore = {
  async insert({ id, name, email = null, tokenHash, tokenEncrypted = null, createdAt, active = true, role = 'attendant' }) {
    await query(
      'INSERT INTO admin_users (id, name, email, token_hash, token_encrypted, active, role, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, name, email, tokenHash, tokenEncrypted, Boolean(active), String(role || 'attendant'), createdAt]
    );
  },

  async list({ limit = 200 } = {}) {
    const finalLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const r = await query(
      'SELECT id, name, email, role, active, created_at FROM admin_users ORDER BY created_at DESC LIMIT $1',
      [finalLimit]
    );
    return r.rows;
  },

  async listWithEncryptedTokens({ limit = 200 } = {}) {
    const finalLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const r = await query(
      'SELECT id, name, email, role, active, created_at, token_encrypted FROM admin_users ORDER BY created_at DESC LIMIT $1',
      [finalLimit]
    );
    return r.rows;
  },

  async getActiveByTokenHash(tokenHash) {
    const r = await query(
      'SELECT id, name, email, role, active, created_at, token_expires_at FROM admin_users WHERE token_hash = $1 AND active = true',
      [tokenHash]
    );
    return r.rows[0] || null;
  },

  async getById(id) {
    const r = await query('SELECT id, name, email, role, active, created_at FROM admin_users WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  async getByEmail(email) {
    const r = await query('SELECT id, name, email, role, active, created_at FROM admin_users WHERE email = $1', [email]);
    return r.rows[0] || null;
  },

  async deactivate(id) {
    await query('UPDATE admin_users SET active = false WHERE id = $1', [id]);
  },

  async updateTokenHash(id, tokenHash, tokenEncrypted = null, tokenExpiresAt = null) {
    const r = await query(
      'UPDATE admin_users SET token_hash = $2, token_encrypted = $3, token_expires_at = $4, active = true WHERE id = $1 RETURNING id, name, email, role, active, created_at, token_expires_at',
      [id, tokenHash, tokenEncrypted, tokenExpiresAt]
    );
    return r.rows[0] || null;
  },

  async upsertInvite({ email, role, name, tokenHash, tokenEncrypted }) {
    const tokenExpiresAt = addDays(new Date(), 7);
    const r = await query(
      `
      INSERT INTO admin_users (id, name, email, token_hash, token_encrypted, token_expires_at, active, role)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, $6)
      ON CONFLICT (email)
      DO UPDATE SET
        name = EXCLUDED.name,
        token_hash = EXCLUDED.token_hash,
        token_encrypted = EXCLUDED.token_encrypted,
        token_expires_at = EXCLUDED.token_expires_at,
        active = true,
        role = EXCLUDED.role
      RETURNING id, name, email, role, active, created_at, token_expires_at
      `,
      [name, email, tokenHash, tokenEncrypted, tokenExpiresAt, role]
    );
    return r.rows[0] || null;
  },

  async clearTokenExpiry(id) {
    await query('UPDATE admin_users SET token_expires_at = NULL WHERE id = $1', [id]);
  },

  async remove(id) {
    await query('DELETE FROM admin_users WHERE id = $1', [id]);
  },
};

module.exports = { adminUsersStore };
