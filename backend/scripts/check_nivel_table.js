#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const sequelize = require('../config/database');

async function main(){
  try {
    console.log('Connecting to DB...');
    await sequelize.authenticate();
    console.log('Connected. Checking nivel tables...');
    
    const tables = await sequelize.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%nivel%'`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    console.log('Tables with "nivel":', JSON.stringify(tables, null, 2));
    
    if (tables.length > 0) {
      const tableName = tables[0].table_name;
      const cols = await sequelize.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tableName}'`,
        { type: sequelize.QueryTypes.SELECT }
      );
      console.log(`\nColumns in ${tableName}:`, cols.map(c => c.column_name).join(', '));
      
      const sample = await sequelize.query(
        `SELECT * FROM ${tableName} LIMIT 3`,
        { type: sequelize.QueryTypes.SELECT }
      );
      console.log('\nSample data:', JSON.stringify(sample, null, 2));
    }
    
    process.exit(0);
  } catch(err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
