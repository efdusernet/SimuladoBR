#!/usr/bin/env node
/*
  Reset exam-related data (on-demand cleanup).
  This script deletes all exam attempts, attempt questions, attempt answers.
  It preserves users and exam types by default.

  SAFETY:
  - Requires env var ALLOW_RESET=TRUE
  - Requires --force flag
  - Dry-run by default unless --execute provided

  Usage examples:
    ALLOW_RESET=TRUE node backend/scripts/reset_exam_data.js --force           # dry-run summary
    ALLOW_RESET=TRUE node backend/scripts/reset_exam_data.js --force --execute # perform deletion

  Optional flags:
    --include-types      Also truncate exam_type table (NOT recommended in production)
    --keep-seed          Keep seed questions (future extension)
    --backup             Perform JSON backup of target tables before truncation
    --no-backup          Skip backup even if --execute provided

  NOTE: Adjust table names if your physical schema uses different casing.
*/

const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function parseFlags(){
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  return {
    force: flags.has('--force'),
    execute: flags.has('--execute'),
    includeTypes: flags.has('--include-types'),
    keepSeed: flags.has('--keep-seed'),
    backup: flags.has('--backup'),
    noBackup: flags.has('--no-backup'),
  };
}

async function main(){
  const { force, execute, includeTypes, backup, noBackup } = parseFlags();

  if (process.env.ALLOW_RESET !== 'TRUE') {
    console.error('[ABORT] Missing ALLOW_RESET=TRUE in environment.');
    process.exit(1);
  }
  if (!force) {
    console.error('[ABORT] Missing required --force flag.');
    process.exit(1);
  }

  const dbName = process.env.DB_NAME;
  const dbUser = process.env.DB_USER;
  const dbPass = process.env.DB_PASSWORD || '';
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;

  const sequelize = new Sequelize(dbName, dbUser, dbPass, {
    host: dbHost,
    port: dbPort,
    dialect: 'postgres',
    logging: process.env.SEQUELIZE_LOG === 'true' ? console.log : false,
  });

  const tables = [
    'exam_attempt_answer',
    'exam_attempt_question',
    'exam_attempt',
  ];
  if (includeTypes) tables.push('exam_type');

  console.log('--- RESET PLAN ---');
  console.log('Database:', dbName);
  console.log('Host:', dbHost + ':' + dbPort);
  console.log('Tables to truncate (cascade):', tables.join(', '));
  console.log('Mode:', execute ? 'EXECUTE (will delete data)' : 'DRY-RUN (no changes)');
  const willBackup = execute && !noBackup && (backup || true); // backup por padrão ao executar, pode desativar com --no-backup
  console.log('Backup before truncate:', willBackup ? 'YES' : 'NO');

  try {
    await sequelize.authenticate();
    console.log('[OK] Connected.');
  } catch (e) {
    console.error('[ERROR] Connection failed:', e.message);
    process.exit(2);
  }

  if (!execute) {
    console.log('\nDry-run complete. Re-run with --execute to apply.');
    await sequelize.close();
    return;
  }

  // Backup stage
  if (willBackup) {
    try {
      const fs = require('fs');
      const backupDir = path.resolve(__dirname, '../backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      const runDir = path.join(backupDir, 'reset_' + ts);
      fs.mkdirSync(runDir);
      console.log('[BACKUP] Directory:', runDir);
      for (const t of tables) {
        console.log('[BACKUP] Exporting table', t);
        const rows = await sequelize.query(`SELECT * FROM ${t}`, { type: sequelize.QueryTypes.SELECT });
        fs.writeFileSync(path.join(runDir, `${t}.json`), JSON.stringify(rows, null, 2));
      }
      console.log('[BACKUP] Completed JSON export of', tables.length, 'tables.');
    } catch (e) {
      console.error('[WARN] Backup step failed:', e.message);
    }
  }

  try {
    for (const t of tables) {
      // Use TRUNCATE with RESTART IDENTITY to reset sequences
      const sql = `TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE;`;
      console.log('[TRUNCATE]', t);
      await sequelize.query(sql);
    }
    console.log('\n[SUCCESS] Exam data truncated.');
    if (willBackup) console.log('[INFO] Backup artifacts retained in backups/ directory.');
  } catch (e) {
    console.error('[ERROR] Truncation failed:', e.message);
    process.exit(3);
  } finally {
    await sequelize.close();
  }
}

main().catch(e => { console.error('[FATAL]', e); process.exit(99); });
