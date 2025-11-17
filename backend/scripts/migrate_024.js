#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const sequelize = require('../config/database');

async function main(){
  try {
    console.log('Connecting to DB...');
    await sequelize.authenticate();
    console.log('Connected. Running migration...');
    
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '024_alter_questao_add_imagem_url.sql'), 'utf8');
    await sequelize.query(sql);
    
    console.log('✓ Migration 024_alter_questao_add_imagem_url.sql applied successfully');
    process.exit(0);
  } catch(err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
