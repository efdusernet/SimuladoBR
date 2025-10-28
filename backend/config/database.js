const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  dialect: 'postgres',
  // Disable SQL logging by default. Set SEQUELIZE_LOG=true in .env to enable.
  logging: process.env.SEQUELIZE_LOG === 'true' ? console.log : false,
});

module.exports = sequelize;