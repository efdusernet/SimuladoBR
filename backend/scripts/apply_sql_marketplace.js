#!/usr/bin/env node
/*
  Simple SQL applier for backend/sql_marketplace/*.sql (sorted ascending by filename).
  Uses marketplace Sequelize connection via backend/config/marketplaceDatabase.js.

  Required env vars (choose one option):
  - MARKETPLACE_DB_URL=postgres://...
  OR
  - MARKETPLACE_DB_NAME, MARKETPLACE_DB_USER, MARKETPLACE_DB_PASSWORD, MARKETPLACE_DB_HOST (+ optional MARKETPLACE_DB_PORT)
*/

const fs = require('fs');
const path = require('path');

// Load env from both locations (backend first, then root), without overriding existing vars.
const backendEnv = path.resolve(__dirname, '..', '.env');
const rootEnv = path.resolve(__dirname, '..', '..', '.env');

if (fs.existsSync(backendEnv)) {
  require('dotenv').config({ path: backendEnv });
} else if (fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv });
}

// Merge root env (do not override) when both files exist.
if (fs.existsSync(backendEnv) && fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv });
}

const { sequelize, configured } = require('../config/marketplaceDatabase');

async function main() {
  if (!configured || !sequelize) {
    console.error('[apply-sql-marketplace] Marketplace DB is not configured. Set MARKETPLACE_DB_URL or MARKETPLACE_DB_* env vars.');
    process.exit(1);
  }

  const sqlDir = path.join(__dirname, '..', 'sql_marketplace');
  if (!fs.existsSync(sqlDir)) {
    console.error('[apply-sql-marketplace] SQL directory not found:', sqlDir);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const files = fs.readdirSync(sqlDir)
    .filter(f => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

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
    console.error('[apply-sql-marketplace] No matching .sql files for args:', args.join(' '));
    console.error('[apply-sql-marketplace] Available:', files.join(', '));
    process.exit(1);
  }
  if (!selected.length) {
    console.log('[apply-sql-marketplace] No .sql files found in', sqlDir);
    process.exit(0);
  }

  console.log('[apply-sql-marketplace] Connecting to marketplace DB...');
  await sequelize.authenticate();
  console.log('[apply-sql-marketplace] Connected. Applying', selected.length, 'files...');

  for (const f of selected) {
    const full = path.join(sqlDir, f);
    const content = fs.readFileSync(full, 'utf8');
    if (!content || !content.trim()) {
      console.log(' - skip empty', f);
      continue;
    }
    console.log(' - applying', f, '...');
    try {
      await sequelize.query(content);
    } catch (e) {
      console.warn('   batch failed, splitting statements:', e.message);
      const parts = content.split(/;\s*(\r?\n|$)/g).map(p => p.trim()).filter(Boolean);
      for (const [idx, stmt] of parts.entries()) {
        try {
          if (!stmt) continue;
          await sequelize.query(stmt);
        } catch (ee) {
          console.error(`   error in ${f} part ${idx + 1}:`, ee.message);
          throw ee;
        }
      }
    }
  }

  console.log('[apply-sql-marketplace] Done.');
  process.exit(0);
}

main().catch(err => {
  console.error('[apply-sql-marketplace] Fatal error:', err);
  process.exit(1);
});
