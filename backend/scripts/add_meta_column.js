// Quick script to add Meta column to EmailVerification table
require('dotenv').config();
const sequelize = require('../config/database');

async function addMetaColumn() {
  try {
    await sequelize.authenticate();
    console.log('Connected to database');
    
    const sql = `ALTER TABLE "EmailVerification" ADD COLUMN IF NOT EXISTS "Meta" TEXT;`;
    await sequelize.query(sql);
    
    console.log('✅ Meta column added successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

addMetaColumn();
