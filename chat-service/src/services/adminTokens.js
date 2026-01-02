const crypto = require('crypto');
const { env } = require('../config/env');

function hashAdminToken(token) {
  const pepper = String(env.ADMIN_TOKEN_PEPPER || '').trim();
  const input = pepper ? `${pepper}:${token}` : token;
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function generateAdminToken() {
  // 32 bytes => 64 hex chars
  return crypto.randomBytes(32).toString('hex');
}

function getTokenEncryptionKey() {
  const raw = String(env.ADMIN_TOKEN_ENCRYPTION_KEY || '').trim();
  if (raw) {
    // Accept 64-hex chars, or base64.
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    try {
      const b = Buffer.from(raw, 'base64');
      if (b.length === 32) return b;
    } catch {}
    throw new Error('ADMIN_TOKEN_ENCRYPTION_KEY inválida (use 32 bytes base64 ou 64 hex)');
  }

  // Fallback: derive a stable key from server secrets.
  const pepper = String(env.ADMIN_TOKEN_PEPPER || '').trim();
  const bootstrap = String(env.ADMIN_TOKEN || '').trim();
  if (!pepper && !bootstrap) {
    throw new Error('ADMIN_TOKEN_ENCRYPTION_KEY não configurada e não há segredo para derivar (defina ADMIN_TOKEN_ENCRYPTION_KEY)');
  }

  return crypto
    .createHash('sha256')
    .update(`${pepper}:${bootstrap}`, 'utf8')
    .digest();
}

function encryptAdminToken(token) {
  const key = getTokenEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv).base64(tag).base64(ciphertext)
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

function decryptAdminToken(tokenEncrypted) {
  const key = getTokenEncryptionKey();
  const raw = String(tokenEncrypted || '').trim();
  if (!raw) return '';

  const parts = raw.split('.');
  if (parts.length !== 3) throw new Error('token_encrypted inválido');

  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = {
  hashAdminToken,
  generateAdminToken,
  encryptAdminToken,
  decryptAdminToken,
};
