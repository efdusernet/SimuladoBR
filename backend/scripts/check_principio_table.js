#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const sequelize = require('../config/database');

async function main(){
  try {
    console.log('Connecting to DB...');
    await sequelize.authenticate();
    console.log('Connected. Checking principios table...');
    
    const cols = await sequelize.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'principios'`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    console.log('Columns in principios:', cols.map(c => c.column_name).join(', '));
    
    const sample = await sequelize.query(
      `SELECT * FROM principios LIMIT 3`,
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log('\nSample data:', JSON.stringify(sample, null, 2));
    
    process.exit(0);
  } catch(err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
