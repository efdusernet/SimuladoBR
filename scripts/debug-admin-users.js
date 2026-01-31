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
  try {
    await db.sequelize.authenticate();

    const users = await db.sequelize.query(
      `SELECT u."Id", u."Email", u."NomeUsuario"
       FROM public."Usuario" u
       WHERE EXISTS (
         SELECT 1
         FROM public.user_role ur
         JOIN public.role r ON r.id = ur.role_id
         WHERE ur.user_id = u."Id" AND r.slug = 'admin' AND (r.ativo = TRUE OR r.ativo IS NULL)
       )
       ORDER BY u."Id" ASC`,
      { type: db.Sequelize.QueryTypes.SELECT }
    );

    console.log('Admin users by RBAC:', users.length);
    for (const u of users) {
      console.log(`- Id=${u.Id} Email=${u.Email} NomeUsuario=${u.NomeUsuario}`);
    }

    const sampleEmail = process.argv[2];
    if (sampleEmail) {
      const emailLower = String(sampleEmail).trim().toLowerCase();
      const r = await db.sequelize.query(
        `SELECT u."Id", u."Email", u."NomeUsuario",
                EXISTS (
                  SELECT 1
                  FROM public.user_role ur
                  JOIN public.role r ON r.id = ur.role_id
                  WHERE ur.user_id = u."Id" AND r.slug = 'admin' AND (r.ativo = TRUE OR r.ativo IS NULL)
                ) AS "HasAdminRole"
         FROM public."Usuario" u
         WHERE LOWER(u."Email") = :email
         LIMIT 1`,
        { replacements: { email: emailLower }, type: db.Sequelize.QueryTypes.SELECT }
      );
      console.log('Lookup:', r && r[0] ? r[0] : null);
    }

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
