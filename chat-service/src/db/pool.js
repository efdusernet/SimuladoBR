const { Pool } = require('pg');
const { env, assertEnv } = require('../config/env');

let pool = null;

function getPool() {
  if (pool) return pool;

  assertEnv();

  const sslMode = String(env.PGSSLMODE || '').toLowerCase();
  const ssl = (sslMode === 'require' || sslMode === 'verify-full')
    ? { rejectUnauthorized: sslMode === 'verify-full' }
    : false;

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl,
  });

  return pool;
}

async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

module.exports = { getPool, query };
