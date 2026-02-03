import path from 'node:path';

import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  dotenv.config({ path: envPath });
}

async function main() {
  loadDotEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL not set. Configure .env or set env var.\n');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const { rows } = await client.query(
      "select to_regclass('public.payment_events') as payment_events, to_regclass('public.admin_audit_log') as admin_audit_log;"
    );
    process.stdout.write(JSON.stringify(rows[0]) + '\n');
  } finally {
    await client.end().catch(() => {});
  }
}

await main();
