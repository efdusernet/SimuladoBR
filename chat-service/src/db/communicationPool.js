const { Pool } = require('pg');
const { env } = require('../config/env');

let pool = null;
let poolMeta = null;

function safeParseDbInfo(connectionString) {
  try {
    const u = new URL(connectionString);
    return {
      host: u.hostname || '',
      port: u.port || '',
      database: (u.pathname || '').replace(/^\//, ''),
    };
  } catch (_) {
    return { host: '', port: '', database: '' };
  }
}

function getCommunicationPool() {
  if (pool) return pool;

  const sslMode = String(env.COMMUNICATION_PGSSLMODE || env.PGSSLMODE || '').toLowerCase();
  const ssl = (sslMode === 'require' || sslMode === 'verify-full')
    ? { rejectUnauthorized: sslMode === 'verify-full' }
    : false;

  let source = 'DATABASE_URL';
  let connectionString = env.DATABASE_URL;

  if (env.COMMUNICATION_DATABASE_URL) {
    source = 'COMMUNICATION_DATABASE_URL';
    connectionString = env.COMMUNICATION_DATABASE_URL;
  } else if (env.COMMUNICATION_DB_NAME || env.COMMUNICATION_DB_HOST || env.COMMUNICATION_DB_USER) {
    // Build a connection string from discrete pieces.
    // NOTE: user/pass may require URL encoding (e.g., '@' must be %40).
    source = 'COMMUNICATION_DB_*';
    const user = encodeURIComponent(String(env.COMMUNICATION_DB_USER || ''));
    const pass = env.COMMUNICATION_DB_PASSWORD ? encodeURIComponent(String(env.COMMUNICATION_DB_PASSWORD)) : '';
    const auth = user ? (pass ? `${user}:${pass}` : user) : '';
    const host = String(env.COMMUNICATION_DB_HOST || 'localhost');
    const port = String(env.COMMUNICATION_DB_PORT || '5432');
    const dbName = String(env.COMMUNICATION_DB_NAME || '');
    const authPart = auth ? `${auth}@` : '';
    const portPart = port ? `:${port}` : '';
    const pathPart = dbName ? `/${encodeURIComponent(dbName)}` : '';
    connectionString = `postgres://${authPart}${host}${portPart}${pathPart}`;
  }

  poolMeta = {
    source,
    ...safeParseDbInfo(connectionString),
  };

  pool = new Pool({ connectionString, ssl });
  return pool;
}

async function communicationQuery(text, params) {
  const p = getCommunicationPool();
  return p.query(text, params);
}

function getCommunicationDbInfo() {
  // Force init so meta is populated.
  getCommunicationPool();
  return poolMeta || { source: env.COMMUNICATION_DATABASE_URL ? 'COMMUNICATION_DATABASE_URL' : 'DATABASE_URL', host: '', port: '', database: '' };
}

module.exports = { getCommunicationPool, communicationQuery, getCommunicationDbInfo };
