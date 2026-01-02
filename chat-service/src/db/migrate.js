const fs = require('fs');
const path = require('path');
const { query, getPool } = require('./pool');

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function listApplied() {
  const r = await query('SELECT id FROM schema_migrations');
  return new Set(r.rows.map(x => String(x.id)));
}

function listSqlMigrations() {
  const sqlDir = path.join(__dirname, '..', '..', 'sql');
  const files = fs.readdirSync(sqlDir)
    .filter(f => /^\d+_.*\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b));
  return files.map(f => ({
    id: f,
    filePath: path.join(sqlDir, f),
  }));
}

async function applyMigration({ id, sql }) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  await ensureMigrationsTable();
  const applied = await listApplied();
  const migrations = listSqlMigrations();

  let ran = 0;
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const sql = fs.readFileSync(m.filePath, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`[migrate] applying ${m.id}`);
    await applyMigration({ id: m.id, sql });
    ran++;
  }

  // eslint-disable-next-line no-console
  console.log(`[migrate] done (applied: ${ran})`);

  const pool = getPool();
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] failed', err);
  process.exitCode = 1;
});
