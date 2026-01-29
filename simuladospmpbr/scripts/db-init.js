import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import pg from 'pg';

import { ensureDatabaseExists } from './db-check.js';

const { Client } = pg;

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  dotenv.config({ path: envPath });
}

async function applySchema(databaseUrl, schemaPath) {
  const sql = await fs.readFile(schemaPath, 'utf8');
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query(sql);
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

  const schemaPath = path.resolve(process.cwd(), 'db', 'schema.sql');

  try {
    await ensureDatabaseExists(databaseUrl);

    process.stdout.write(`[db:init] Applying schema: ${schemaPath}\n`);
    await applySchema(databaseUrl, schemaPath);

    process.stdout.write('[db:init] Done.\n');
  } catch (err) {
    process.stderr.write(String(err?.message ?? err) + '\n');
    process.exit(1);
  }
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main();
}
