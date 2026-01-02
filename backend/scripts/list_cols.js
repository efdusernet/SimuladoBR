#!/usr/bin/env node
// Lists column names for notification and user_notification tables
const db = require('../models');
(async () => {
  try {
    await db.sequelize.authenticate();
    const [nCols] = await db.sequelize.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='notification' ORDER BY ordinal_position");
    const [uCols] = await db.sequelize.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='user_notification' ORDER BY ordinal_position");
    console.log('notification columns:', nCols);
    console.log('user_notification columns:', uCols);
  } catch (e) {
    console.error('LIST_COLS_ERROR', e.message);
  } finally {
    await db.sequelize.close();
  }
})();