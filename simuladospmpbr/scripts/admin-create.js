import path from 'node:path';

import dotenv from 'dotenv';

import { createAdminUser } from '../src/db/adminUsers.repo.js';

function loadDotEnv() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

function parseArgs(argv) {
  const args = { email: null, password: null, role: 'admin', active: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];

    if (a === '--email' && next) {
      args.email = next;
      i++;
      continue;
    }
    if (a === '--password' && next) {
      args.password = next;
      i++;
      continue;
    }
    if (a === '--role' && next) {
      args.role = next;
      i++;
      continue;
    }
    if (a === '--inactive') {
      args.active = false;
      continue;
    }
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
  }
  return args;
}

async function main() {
  loadDotEnv();

  const args = parseArgs(process.argv);
  if (args.help || !args.email || !args.password) {
    process.stdout.write('Usage:\n');
    process.stdout.write('  node scripts/admin-create.js --email you@example.com --password "yourpass" [--role admin] [--inactive]\n');
    process.exit(args.help ? 0 : 1);
  }

  const user = await createAdminUser({
    email: args.email,
    password: args.password,
    role: args.role,
    isActive: args.active
  });

  process.stdout.write(`OK: ${user.email} (id=${user.id}, role=${user.role}, active=${user.is_active})\n`);
}

main().catch((err) => {
  process.stderr.write(String(err?.message ?? err) + '\n');
  process.exit(1);
});
