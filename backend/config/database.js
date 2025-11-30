const { Sequelize } = require('sequelize');
const path = require('path');

// Load env: prefer backend/.env; if absent, fallback to project root .env
const fs = require('fs');
const backendEnv = path.resolve(__dirname, '../.env');
const rootEnv = path.resolve(__dirname, '..', '..', '.env');
let chosenEnv = backendEnv;
if (!fs.existsSync(backendEnv) && fs.existsSync(rootEnv)) {
  chosenEnv = rootEnv;
}
require('dotenv').config({ path: chosenEnv });
if (process.env.SEQUELIZE_LOG === 'true') {
  console.log('[db] env loaded from', chosenEnv);
}

const dbName = process.env.DB_NAME;
const dbUser = process.env.DB_USER;
const rawPass = process.env.DB_PASSWORD;
const dbPass = typeof rawPass === 'string' ? rawPass : (rawPass == null ? '' : String(rawPass)); // force string
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;

// Debug removed: avoid logging database credentials/meta

const sequelize = new Sequelize(dbName, dbUser, dbPass || '', {
  host: dbHost,
  port: dbPort,
  dialect: 'postgres',
  // Disable SQL logging by default. Set SEQUELIZE_LOG=true in .env to enable.
  logging: process.env.SEQUELIZE_LOG === 'true' ? console.log : false,
});

module.exports = sequelize;