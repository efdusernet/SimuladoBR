const dotenv = require('dotenv');

const dotenvResult = dotenv.config();

// If a variable is present but blank in the process environment, dotenv will not override it
// by default. We want .env to populate missing/blank values, but still allow real overrides.
if (dotenvResult && dotenvResult.parsed) {
  for (const [key, value] of Object.entries(dotenvResult.parsed)) {
    const current = process.env[key];
    if (current == null || String(current).trim() === '') {
      process.env[key] = value;
    }
  }
}

function getEnv(name, fallback = '') {
  const v = process.env[name];
  return (v == null || String(v).trim() === '') ? fallback : String(v).trim();
}

function getEnvInt(name, fallback, { min = undefined, max = undefined } = {}) {
  const raw = getEnv(name, String(fallback));
  const n = Number(raw);
  if (!Number.isFinite(n)) return Number(fallback);
  if (Number.isFinite(min) && n < min) return Number(fallback);
  if (Number.isFinite(max) && n > max) return Number(fallback);
  return Math.floor(n);
}

function parseCsv(raw) {
  return String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
function parseNamedTokens(raw) {
  // Format: "Name=token,Other Name=token2" (comma-separated)
  // Returns array of { name, token }
  return parseCsv(raw).map((pair) => {
    const s = String(pair);
    const idx = s.indexOf('=');
    if (idx <= 0) return { name: '', token: '' };
    return {
      name: s.slice(0, idx).trim(),
      token: s.slice(idx + 1).trim(),
    };
  }).filter(x => x.name && x.token);
}

const env = {
  NODE_ENV: getEnv('NODE_ENV', 'development'),
  PORT: getEnvInt('PORT', 4010, { min: 1, max: 65535 }),
  CORS_ORIGINS: parseCsv(getEnv('CORS_ORIGINS', 'http://app.localhost:3000,http://localhost:3000')),

  // Admin panel (required for /v1/admin/*)
  ADMIN_TOKEN: getEnv('ADMIN_TOKEN', ''),
  // Optional multi-user admin tokens: "Alice=token1,Bob=token2"
  ADMIN_TOKENS: parseNamedTokens(getEnv('ADMIN_TOKENS', '')),
  // Optional: pepper used when hashing DB-stored attendant tokens
  ADMIN_TOKEN_PEPPER: getEnv('ADMIN_TOKEN_PEPPER', ''),

  // Optional: encryption key for storing admin/attendant tokens for audit.
  // Accepts either 64 hex chars (32 bytes) or base64 encoding of 32 bytes.
  // If missing, the service derives a key from ADMIN_TOKEN_PEPPER + ADMIN_TOKEN.
  ADMIN_TOKEN_ENCRYPTION_KEY: getEnv('ADMIN_TOKEN_ENCRYPTION_KEY', ''),

  DATABASE_URL: getEnv('DATABASE_URL', ''),
  PGSSLMODE: getEnv('PGSSLMODE', 'disable'),

  // Optional: separate DB for SimuladosBR (to read communication_recipient + usuario)
  // If omitted, falls back to DATABASE_URL.
  COMMUNICATION_DATABASE_URL: getEnv('COMMUNICATION_DATABASE_URL', ''),
  COMMUNICATION_PGSSLMODE: getEnv('COMMUNICATION_PGSSLMODE', ''),

  // Alternative config style: discrete pieces to build the communication DB URL.
  // Useful when you already have DB_NAME/DB_USER/DB_HOST/DB_PORT style variables.
  COMMUNICATION_DB_NAME: getEnv('COMMUNICATION_DB_NAME', ''),
  COMMUNICATION_DB_USER: getEnv('COMMUNICATION_DB_USER', ''),
  COMMUNICATION_DB_PASSWORD: getEnv('COMMUNICATION_DB_PASSWORD', ''),
  COMMUNICATION_DB_HOST: getEnv('COMMUNICATION_DB_HOST', ''),
  COMMUNICATION_DB_PORT: getEnv('COMMUNICATION_DB_PORT', ''),

  // SMTP (optional, used for /v1/admin/invites)
  SMTP_HOST: getEnv('SMTP_HOST', ''),
  SMTP_PORT: getEnvInt('SMTP_PORT', 587, { min: 1, max: 65535 }),
  SMTP_USER: getEnv('SMTP_USER', ''),
  SMTP_PASS: getEnv('SMTP_PASS', ''),
  EMAIL_FROM: getEnv('EMAIL_FROM', ''),
  SMTP_ALLOW_SELF_SIGNED: getEnv('SMTP_ALLOW_SELF_SIGNED', '').toLowerCase() === 'true',

  JWT_PUBLIC_KEY_PEM: getEnv('JWT_PUBLIC_KEY_PEM', ''),
  JWT_ISSUER: getEnv('JWT_ISSUER', ''),
  JWT_AUDIENCE: getEnv('JWT_AUDIENCE', ''),
  JWT_ALGORITHMS: parseCsv(getEnv('JWT_ALGORITHMS', 'RS256')),

  // LLM (optional)
  LLM_PROVIDER: getEnv('LLM_PROVIDER', 'ollama').toLowerCase(),
  OLLAMA_ENABLED: getEnv('OLLAMA_ENABLED', '').toLowerCase() === 'true',
  OLLAMA_URL: getEnv('OLLAMA_URL', 'http://localhost:11434'),
  OLLAMA_MODEL: getEnv('OLLAMA_MODEL', 'llama3.1:8b'),
  OLLAMA_TIMEOUT_MS: getEnvInt('OLLAMA_TIMEOUT_MS', 60000, { min: 5000, max: 900000 }),

  GEMINI_API_KEY: getEnv('GEMINI_API_KEY', ''),
  GEMINI_API_BASE: getEnv('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com/v1beta'),
  GEMINI_MODEL: getEnv('GEMINI_MODEL', 'gemini-1.5-flash'),
  GEMINI_TIMEOUT_MS: getEnvInt('GEMINI_TIMEOUT_MS', 60000, { min: 5000, max: 900000 }),
};

function assertEnv() {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL não configurada (ver .env.example)');
  }
}

module.exports = { env, getEnv, getEnvInt, assertEnv };
