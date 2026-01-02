require('dotenv').config({ override: true });

const { Client } = require('pg');

function parseArgs(argv) {
  const args = { yes: false, dryRun: false, status: null, origin: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = String(argv[i] || '');
    if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--status') {
      args.status = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (a === '--origin') {
      args.origin = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      args.unknown = args.unknown || [];
      args.unknown.push(a);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/purgeConversations.js [--status <open|closed|...>] [--origin <widget|...>] [--dry-run] [--yes]',
    '',
    'Examples:',
    '  node scripts/purgeConversations.js --dry-run',
    '  node scripts/purgeConversations.js --yes',
    '  node scripts/purgeConversations.js --status open --yes',
    '  node scripts/purgeConversations.js --origin widget --yes',
    '',
    'Notes:',
    '- This deletes rows from public.conversations; messages are deleted via ON DELETE CASCADE.',
    '- Visitors are NOT deleted (safe).',
  ].join('\n');
}

async function promptConfirm(question) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return String(answer || '').trim();
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (args.unknown && args.unknown.length)) {
    // eslint-disable-next-line no-console
    console.log(usage());
    if (args.unknown && args.unknown.length) {
      // eslint-disable-next-line no-console
      console.log('\nUnknown args: ' + args.unknown.join(' '));
      process.exitCode = 2;
    }
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL not set');

  const whereParts = [];
  const params = [];
  let p = 1;

  if (args.status) {
    whereParts.push(`status = $${p}`);
    params.push(args.status);
    p += 1;
  }

  if (args.origin) {
    whereParts.push(`origin = $${p}`);
    params.push(args.origin);
    p += 1;
  }

  const whereSql = whereParts.length ? ('WHERE ' + whereParts.join(' AND ')) : '';

  const client = new Client({ connectionString });
  await client.connect();

  const info = await client.query('select current_database() as db, current_schema() as schema');

  const countRes = await client.query(
    `SELECT COUNT(*)::int AS count FROM conversations ${whereSql}`,
    params
  );

  const total = Number(countRes.rows[0] && countRes.rows[0].count ? countRes.rows[0].count : 0);

  // eslint-disable-next-line no-console
  console.log('[purgeConversations] target', {
    db: info.rows[0] ? info.rows[0].db : null,
    schema: info.rows[0] ? info.rows[0].schema : null,
    where: whereSql || '(no filter)',
    count: total,
    dryRun: args.dryRun,
  });

  if (total === 0) {
    await client.end();
    return;
  }

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log('[purgeConversations] dry-run: no rows deleted');
    await client.end();
    return;
  }

  if (!args.yes) {
    const answer = await promptConfirm(`Type DELETE (${total}) to confirm: `);
    if (answer !== `DELETE (${total})`) {
      // eslint-disable-next-line no-console
      console.log('[purgeConversations] cancelled');
      await client.end();
      process.exitCode = 1;
      return;
    }
  }

  await client.query('BEGIN');
  try {
    const del = await client.query(
      `DELETE FROM conversations ${whereSql}`,
      params
    );
    await client.query('COMMIT');

    // eslint-disable-next-line no-console
    console.log('[purgeConversations] deleted conversations:', del.rowCount);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[purgeConversations] failed', err);
  process.exitCode = 1;
});
