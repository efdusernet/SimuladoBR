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
  const files = fs.readdirSync(sqlDir)
    .filter(f => f.toLowerCase().endsWith('.sql'))
    .sort((a,b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  if (!files.length) {
    console.log('[apply-sql] No .sql files found in', sqlDir);
    process.exit(0);
  }
  console.log('[apply-sql] Connecting to DB...');
  await sequelize.authenticate();
  console.log('[apply-sql] Connected. Applying', files.length, 'files...');

  for (const f of files) {
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
