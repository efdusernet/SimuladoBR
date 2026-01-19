const db = require('../models');

(async () => {
  try {
    await db.sequelize.authenticate();
    const rows = await db.sequelize.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename ASC",
      { type: db.Sequelize.QueryTypes.SELECT }
    );
    for (const r of rows || []) {
      if (r && r.tablename) process.stdout.write(String(r.tablename) + "\n");
    }
  } catch (e) {
    process.stderr.write('ERROR: ' + ((e && e.message) ? e.message : String(e)) + "\n");
    process.exitCode = 1;
  } finally {
    try { await db.sequelize.close(); } catch {}
  }
})();
