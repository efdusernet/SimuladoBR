const { Sequelize } = require('sequelize');
const path = require('path');

// Always load .env from the backend folder to avoid CWD issues when starting from repo root
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const dbName = process.env.DB_NAME;
const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASSWORD; // dotenv always returns strings; ensure fallback to '' if undefined
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;

const sequelize = new Sequelize(dbName, dbUser, dbPass || '', {
  host: dbHost,
  port: dbPort,
  dialect: 'postgres',
  // Disable SQL logging by default. Set SEQUELIZE_LOG=true in .env to enable.
  logging: process.env.SEQUELIZE_LOG === 'true' ? console.log : false,
});

module.exports = sequelize;