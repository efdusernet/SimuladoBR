import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

function maskDbUrl(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return String(databaseUrl).replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)([^@/\s]+)(@)/i, '$1***$3');
  }
}

function databaseNameFromUrl(databaseUrl) {
  const u = new URL(databaseUrl);
  const db = u.pathname.replace(/^\//, '');
  return decodeURIComponent(db);
}

function adminDbUrl(databaseUrl) {
  const u = new URL(databaseUrl);
  u.pathname = '/postgres';
  return u.toString();
}

function quoteIdentifier(identifier) {
  // PostgreSQL identifier quoting: double quotes doubled inside.
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

export async function ensureDatabaseExists(databaseUrl) {
  const masked = maskDbUrl(databaseUrl);
  process.stdout.write(`[db:check] Connecting to: ${masked}\n`);

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query('select 1 as ok');
    process.stdout.write('[db:check] OK\n');
    return;
  } catch (err) {
    // 3D000 = invalid_catalog_name (database does not exist)
    if (err && err.code === '3D000') {
      const dbName = databaseNameFromUrl(databaseUrl);
      const adminUrl = adminDbUrl(databaseUrl);

      process.stdout.write(`[db:check] Database '${dbName}' does not exist. Creating...\n`);
      const adminClient = new Client({ connectionString: adminUrl });
      try {
        await adminClient.connect();
        await adminClient.query(`create database ${quoteIdentifier(dbName)};`);
      } finally {
        await adminClient.end().catch(() => {});
      }

      // Re-check
      const client2 = new Client({ connectionString: databaseUrl });
      try {
        await client2.connect();
        await client2.query('select 1 as ok');
      } finally {
        await client2.end().catch(() => {});
      }

      process.stdout.write('[db:check] OK\n');
      return;
    }

    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  loadDotEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL not set. Configure .env or set env var.\n');
    process.exit(1);
  }

  try {
    await ensureDatabaseExists(databaseUrl);
  } catch (err) {
    process.stderr.write(String(err?.message ?? err) + '\n');
    process.exit(1);
  }
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main();
}
