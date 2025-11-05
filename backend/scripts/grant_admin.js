#!/usr/bin/env node
// Grant the 'admin' role to a user by --email, --id or --nomeUsuario
// Usage examples:
//   node scripts/grant_admin.js --email user@example.com
//   node scripts/grant_admin.js --id 123
//   node scripts/grant_admin.js --nomeUsuario fulano

require('dotenv').config();
const db = require('../models');

function parseArgs(){
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++){
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.replace(/^--/, '');
    const val = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : true;
    out[key] = val;
  }
  return out;
}

(async () => {
  const argv = parseArgs();
  try {
    await db.sequelize.authenticate();
  } catch (e) {
    console.error('[grant_admin] DB connection failed:', e.message || e);
    process.exit(2);
  }

  try {
    let user = null;
    if (argv.id && /^\d+$/.test(String(argv.id))) {
      user = await db.User.findByPk(Number(argv.id));
    }
    if (!user && argv.email) {
      const email = String(argv.email).trim().toLowerCase();
      user = await db.User.findOne({ where: { Email: email } });
    }
    if (!user && argv.nomeUsuario) {
      const nomeUsuario = String(argv.nomeUsuario).trim();
      user = await db.User.findOne({ where: { NomeUsuario: nomeUsuario } });
    }
    if (!user) {
      console.error('[grant_admin] User not found. Provide --id, --email or --nomeUsuario');
      process.exit(1);
    }

    // Ensure role 'admin' exists
    let [role] = await db.sequelize.query('SELECT id FROM public.role WHERE slug = :slug LIMIT 1', {
      replacements: { slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT
    });
    if (!role) {
      await db.sequelize.query('INSERT INTO public.role (slug, nome, ativo) VALUES (\'admin\', \'Administrador\', TRUE)');
      [role] = await db.sequelize.query('SELECT id FROM public.role WHERE slug = :slug LIMIT 1', {
        replacements: { slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT
      });
    }
    if (!role || !role.id) { console.error('[grant_admin] Could not ensure admin role'); process.exit(1); }

    // Grant if not already present
    const exists = await db.sequelize.query(
      'SELECT 1 FROM public.user_role WHERE user_id = :uid AND role_id = :rid LIMIT 1',
      { replacements: { uid: user.Id, rid: role.id }, type: db.Sequelize.QueryTypes.SELECT }
    );
    if (exists && exists.length) {
      console.log(`[grant_admin] User ${user.Id} already has admin role.`);
      process.exit(0);
    }
    await db.sequelize.query(
      'INSERT INTO public.user_role (user_id, role_id) VALUES (:uid, :rid)',
      { replacements: { uid: user.Id, rid: role.id }, type: db.Sequelize.QueryTypes.INSERT }
    );
    console.log(`[grant_admin] Granted admin to user ${user.Id}.`);
    process.exit(0);
  } catch (e) {
    console.error('[grant_admin] Error:', e && e.message || e);
    process.exit(1);
  }
})();
