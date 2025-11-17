const sequelize = require('../config/database');

(async () => {
  try {
    const [results] = await sequelize.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema='public' 
        AND table_name='dominiogeral'
      ORDER BY ordinal_position
    `);
    console.log('dominiogeral columns:', JSON.stringify(results, null, 2));
    
    const [rows] = await sequelize.query(`SELECT * FROM dominiogeral LIMIT 5`);
    console.log('\nSample data:', JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await sequelize.close();
  }
})();
