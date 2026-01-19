#!/usr/bin/env node
/*
  Simple SQL applier for backend/sql/*.sql (sorted ascending by filename).
  Uses existing Sequelize connection via backend/config/database.js.
  Reads .env for DB connection variables.
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const sequelize = require('../config/database');

async function main(){
  const sqlDir = path.join(__dirname, '..', 'sql');
  if (!fs.existsSync(sqlDir)) {
    console.error('[apply-sql] SQL directory not found:', sqlDir);
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const files = fs.readdirSync(sqlDir)
    .filter(f => f.toLowerCase().endsWith('.sql'))
    .sort((a,b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const selected = args.length
    ? files.filter(f => {
        return args.some(a => {
          if (!a) return false;
          const arg = String(a).trim();
          if (!arg) return false;
          if (arg.toLowerCase().endsWith('.sql')) return f.toLowerCase() === arg.toLowerCase();
          if (/^\d+$/.test(arg)) {
            const prefix = arg.padStart(3, '0');
            return f.startsWith(prefix);
          }
          return f.toLowerCase().includes(arg.toLowerCase());
        });
      })
    : files;

  if (args.length && !selected.length) {
    console.error('[apply-sql] No matching .sql files for args:', args.join(' '));
    console.error('[apply-sql] Available:', files.join(', '));
    process.exit(1);
  }
  if (!selected.length) {
    console.log('[apply-sql] No .sql files found in', sqlDir);
    process.exit(0);
  }
  console.log('[apply-sql] Connecting to DB...');
  await sequelize.authenticate();
  console.log('[apply-sql] Connected. Applying', selected.length, 'files...');

  for (const f of selected) {
    const full = path.join(sqlDir, f);
    const content = fs.readFileSync(full, 'utf8');
    if (!content || !content.trim()) { console.log(' - skip empty', f); continue; }
    console.log(' - applying', f, '...');
    try {
      // Attempt to run as a single batch first
      await sequelize.query(content);
    } catch (e) {
      // Fallback: split on semicolons and run piece by piece (best-effort)
      console.warn('   batch failed, splitting statements:', e.message);
      const parts = content.split(/;\s*(\r?\n|$)/g).map(p => p.trim()).filter(Boolean);
      for (const [idx, stmt] of parts.entries()) {
        try {
          if (!stmt) continue;
          await sequelize.query(stmt);
        } catch (ee) {
          console.error(`   error in ${f} part ${idx+1}:`, ee.message);
          throw ee;
        }
      }
    }
  }
  console.log('[apply-sql] Done.');
  process.exit(0);
}

main().catch(err => { console.error('[apply-sql] Fatal error:', err); process.exit(1); });
