const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Load env: prefer backend/.env; if absent, fallback to project root .env
const backendEnv = path.resolve(__dirname, '../.env');
const rootEnv = path.resolve(__dirname, '..', '..', '.env');
let chosenEnv = backendEnv;
if (!fs.existsSync(backendEnv) && fs.existsSync(rootEnv)) {
  chosenEnv = rootEnv;
}
require('dotenv').config({ path: chosenEnv });

const {
  validateMarketplaceEnvVars,
  isMarketplaceDbConfigured,
  getSafeMarketplaceDbConfig,
} = require('./validateEnv');

const configured = isMarketplaceDbConfigured();

if (!configured) {
  module.exports = {
    configured: false,
    sequelize: null,
    chosenEnv,
  };
  return;
}

// Validate marketplace vars (does NOT validate core vars)
try {
  validateMarketplaceEnvVars();
} catch (error) {
  console.error('❌ Failed to initialize marketplace database: invalid environment configuration');
  process.exit(1);
}

if (process.env.SEQUELIZE_LOG === 'true') {
  console.log('[marketplace-db] env loaded from', chosenEnv);
  console.log('[marketplace-db] connecting with config:', getSafeMarketplaceDbConfig());
}

const url = process.env.MARKETPLACE_DB_URL;
const dbName = process.env.MARKETPLACE_DB_NAME;
const dbUser = process.env.MARKETPLACE_DB_USER;
const rawPass = process.env.MARKETPLACE_DB_PASSWORD;
const dbPass = typeof rawPass === 'string' ? rawPass : (rawPass == null ? '' : String(rawPass));
const dbHost = process.env.MARKETPLACE_DB_HOST || 'localhost';
const dbPort = process.env.MARKETPLACE_DB_PORT ? Number(process.env.MARKETPLACE_DB_PORT) : 5432;

const sequelize = url && String(url).trim() !== ''
  ? new Sequelize(String(url), {
      dialect: 'postgres',
      logging: process.env.SEQUELIZE_LOG === 'true' ? console.log : false,
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000
      },
      dialectOptions: {
        ssl: process.env.MARKETPLACE_DB_SSL === 'true' ? {
          require: true,
          rejectUnauthorized: false
        } : false
      }
    })
  : new Sequelize(dbName, dbUser, dbPass, {
      host: dbHost,
      port: dbPort,
      dialect: 'postgres',
      logging: process.env.SEQUELIZE_LOG === 'true' ? console.log : false,
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000
      },
      dialectOptions: {
        ssl: process.env.MARKETPLACE_DB_SSL === 'true' ? {
          require: true,
          rejectUnauthorized: false
        } : false
      }
    });

sequelize.authenticate()
  .then(() => {
    if (process.env.SEQUELIZE_LOG === 'true') {
      console.log('✓ Marketplace database connection established successfully');
    }
  })
  .catch(err => {
    console.error('❌ Unable to connect to marketplace database:', err.message);
    console.error('   Check MARKETPLACE_DB_* variables and ensure PostgreSQL is running');
    if (process.env.NODE_ENV === 'development' && process.env.SEQUELIZE_LOG === 'true') {
      console.error('   Full error (dev mode):', err);
    }
  });

module.exports = {
  configured: true,
  sequelize,
  chosenEnv,
};
