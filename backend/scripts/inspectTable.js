/*
  Usage:
    node scripts/inspectTable.js exam_attempt_incorrect

  Prints:
    - columns
    - primary key / unique constraints
    - foreign keys (inbound + outbound)
    - triggers
    - (best-effort) views/functions that reference the table name
*/

const db = require('../models');

async function main() {
  const table = process.argv[2];
  const schema = process.argv[3] || 'public';

  if (!table) {
    console.error('Usage: node scripts/inspectTable.js <table_name> [schema=public]');
    process.exitCode = 2;
    return;
  }

  const q = (sql, replacements) =>
    db.sequelize.query(sql, { replacements, type: db.Sequelize.QueryTypes.SELECT });

  try {
    const columns = await q(
      `
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default
      FROM information_schema.columns c
      WHERE c.table_schema = :schema
        AND c.table_name = :table
      ORDER BY c.ordinal_position
      `,
      { schema, table }
    );

    const constraints = await q(
      `
      SELECT
        con.conname AS name,
        con.contype AS type,
        pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = :schema
        AND rel.relname = :table
      ORDER BY con.contype, con.conname
      `,
      { schema, table }
    );

    const foreignKeysOutbound = await q(
      `
      SELECT
        con.conname AS name,
        pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE con.contype = 'f'
        AND nsp.nspname = :schema
        AND rel.relname = :table
      ORDER BY con.conname
      `,
      { schema, table }
    );

    const foreignKeysInbound = await q(
      `
      SELECT
        src_nsp.nspname AS source_schema,
        src_rel.relname AS source_table,
        con.conname AS name,
        pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class src_rel ON src_rel.oid = con.conrelid
      JOIN pg_namespace src_nsp ON src_nsp.oid = src_rel.relnamespace
      JOIN pg_class tgt_rel ON tgt_rel.oid = con.confrelid
      JOIN pg_namespace tgt_nsp ON tgt_nsp.oid = tgt_rel.relnamespace
      WHERE con.contype = 'f'
        AND tgt_nsp.nspname = :schema
        AND tgt_rel.relname = :table
      ORDER BY src_nsp.nspname, src_rel.relname, con.conname
      `,
      { schema, table }
    );

    const triggers = await q(
      `
      SELECT
        t.tgname AS name,
        pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t
      JOIN pg_class rel ON rel.oid = t.tgrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = :schema
        AND rel.relname = :table
        AND NOT t.tgisinternal
      ORDER BY t.tgname
      `,
      { schema, table }
    );

    const needle = `%${table}%`;
    const referencingViews = await q(
      `
      SELECT schemaname, viewname
      FROM pg_views
      WHERE definition ILIKE :needle
      ORDER BY schemaname, viewname
      `,
      { needle }
    );

    const referencingMatviews = await q(
      `
      SELECT schemaname, matviewname
      FROM pg_matviews
      WHERE definition ILIKE :needle
      ORDER BY schemaname, matviewname
      `,
      { needle }
    );

    let stats = null;
    try {
      const rows = await q(
        `
        SELECT
          COUNT(*)::bigint AS row_count,
          COUNT(DISTINCT attempt_id)::bigint AS distinct_attempts,
          MAX(created_at) AS max_created_at,
          MIN(created_at) AS min_created_at
        FROM ${schema}.${table}
        `
      );
      stats = rows && rows[0] ? rows[0] : null;
    } catch (_) {
      // If table is huge or permissions block direct access.
      stats = { note: 'stats not available' };
    }

    let referencingFunctions = [];
    try {
      referencingFunctions = await q(
        `
        SELECT n.nspname AS schema, p.proname AS name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE pg_get_functiondef(p.oid) ILIKE :needle
        ORDER BY n.nspname, p.proname
        `,
        { needle }
      );
    } catch (_) {
      // Some setups may block pg_get_functiondef(); fall back to pg_proc.prosrc.
      try {
        referencingFunctions = await q(
          `
          SELECT n.nspname AS schema, p.proname AS name
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosrc ILIKE :needle
          ORDER BY n.nspname, p.proname
          `,
          { needle }
        );
      } catch (__){
        referencingFunctions = [{ schema: null, name: null, note: 'function search not available' }];
      }
    }

    const output = {
      table: `${schema}.${table}`,
      columns,
      constraints,
      foreignKeys: {
        outbound: foreignKeysOutbound,
        inbound: foreignKeysInbound,
      },
      triggers,
      referencedBy: {
        views: referencingViews,
        matviews: referencingMatviews,
        functions: referencingFunctions,
      },
      stats,
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    try {
      await db.sequelize.close();
    } catch (_) {
      // ignore
    }
  }
}

main().catch((e) => {
  console.error('ERROR:', e && e.message ? e.message : e);
  process.exitCode = 1;
});
