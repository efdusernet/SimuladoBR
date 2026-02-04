/*
  Dev utility: grant RBAC admin role to a user by email.

  Usage:
    node scripts/grant-admin-role.js user@example.com

  Notes:
  - Loads backend/.env for DB connection.
  - Safe to run multiple times (idempotent).
*/

const path = require('path');

let dotenv;
try {
  dotenv = require('dotenv');
} catch (_) {
  dotenv = require('../backend/node_modules/dotenv');
}

dotenv.config({ path: path.resolve(__dirname, '..', 'backend', '.env') });

const db = require('../backend/models');

async function main() {
  const emailArg = process.argv[2];
  const email = String(emailArg || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: node scripts/grant-admin-role.js user@example.com');
    process.exit(2);
  }

  try {
    await db.sequelize.authenticate();

    // Ensure role exists
    const roleRows = await db.sequelize.query(
      `SELECT id, slug, ativo FROM public.role WHERE slug = 'admin' LIMIT 1`,
      { type: db.Sequelize.QueryTypes.SELECT }
    );

    let roleId = roleRows && roleRows[0] ? roleRows[0].id : null;
    if (!roleId) {
      const inserted = await db.sequelize.query(
        `INSERT INTO public.role (slug, nome, ativo)
         VALUES ('admin', 'Administrador', TRUE)
         RETURNING id`,
        { type: db.Sequelize.QueryTypes.SELECT }
      );
      roleId = inserted && inserted[0] ? inserted[0].id : null;
    }

    if (!roleId) throw new Error('Failed to resolve/create admin role');

    // Find user
    const userRows = await db.sequelize.query(
      `SELECT "Id", "Email", "NomeUsuario" FROM public.usuario WHERE LOWER("Email") = :email LIMIT 1`,
      { replacements: { email }, type: db.Sequelize.QueryTypes.SELECT }
    );

    const user = userRows && userRows[0] ? userRows[0] : null;
    if (!user) {
      console.error('User not found for email:', email);
      process.exit(1);
    }

    // Insert membership if missing
    await db.sequelize.query(
      `INSERT INTO public.user_role (user_id, role_id)
       SELECT :uid, :rid
       WHERE NOT EXISTS (
         SELECT 1 FROM public.user_role ur WHERE ur.user_id = :uid AND ur.role_id = :rid
       )`,
      { replacements: { uid: user.Id, rid: roleId }, type: db.Sequelize.QueryTypes.INSERT }
    );

    console.log('Granted admin role:', { Id: user.Id, Email: user.Email, NomeUsuario: user.NomeUsuario, roleId });

    // Verify
    const verify = await db.sequelize.query(
      `SELECT EXISTS (
         SELECT 1
         FROM public.user_role ur
         JOIN public.role r ON r.id = ur.role_id
         WHERE ur.user_id = :uid AND r.slug = 'admin' AND (r.ativo = TRUE OR r.ativo IS NULL)
       ) AS "HasAdminRole"`,
      { replacements: { uid: user.Id }, type: db.Sequelize.QueryTypes.SELECT }
    );

    console.log('Verify:', verify && verify[0] ? verify[0] : null);

    process.exit(0);
  } catch (e) {
    console.error('Error:', e && e.message ? e.message : e);
    try {
      if (e && e.original) console.error('Original:', e.original);
    } catch (_) {}
    process.exit(1);
  }
}

main();
