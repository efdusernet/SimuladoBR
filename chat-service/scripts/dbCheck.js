require('dotenv').config({ override: true });

const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set');
  }

  const client = new Client({ connectionString });
  await client.connect();

  const info = await client.query('select current_database() as db, current_schema() as schema');
  const reg = await client.query(
    "select to_regclass('public.visitors') as visitors, to_regclass('public.conversations') as conversations, to_regclass('public.messages') as messages"
  );
  const tables = await client.query(
    "select table_schema, table_name from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog','information_schema') order by table_schema, table_name"
  );

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        info: info.rows[0],
        reg: reg.rows[0],
        tables: tables.rows,
      },
      null,
      2
    )
  );

  await client.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[dbCheck] failed', err);
  process.exitCode = 1;
});
