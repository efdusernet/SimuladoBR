const { Pool } = require('pg');
const { env } = require('../config/env');

let pool = null;

function getCommunicationPool() {
  if (pool) return pool;

  const sslMode = String(env.COMMUNICATION_PGSSLMODE || env.PGSSLMODE || '').toLowerCase();
  const ssl = (sslMode === 'require' || sslMode === 'verify-full')
    ? { rejectUnauthorized: sslMode === 'verify-full' }
    : false;

  const connectionString = env.COMMUNICATION_DATABASE_URL || env.DATABASE_URL;

  pool = new Pool({ connectionString, ssl });
  return pool;
}

async function communicationQuery(text, params) {
  const p = getCommunicationPool();
  return p.query(text, params);
}

module.exports = { getCommunicationPool, communicationQuery };
