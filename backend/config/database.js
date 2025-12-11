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

// Validate environment variables before proceeding
const { validateOnLoad, getSafeDbConfig } = require('./validateEnv');

// Validate required environment variables (will throw if missing/invalid)
try {
  validateOnLoad();
} catch (error) {
  console.error('❌ Failed to initialize database: Invalid environment configuration');
  process.exit(1);
}

// Log safe database configuration (without credentials)
if (process.env.SEQUELIZE_LOG === 'true') {
  console.log('[db] env loaded from', chosenEnv);
  console.log('[db] connecting with config:', getSafeDbConfig());
}

// Extract and validate database credentials
const dbName = process.env.DB_NAME;
const dbUser = process.env.DB_USER;
const rawPass = process.env.DB_PASSWORD;
const dbPass = typeof rawPass === 'string' ? rawPass : (rawPass == null ? '' : String(rawPass));
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;

// Additional runtime validation
if (!dbName || !dbUser || !dbPass) {
  console.error('❌ FATAL: Missing required database credentials (DB_NAME, DB_USER, or DB_PASSWORD)');
  process.exit(1);
}

const sequelize = new Sequelize(dbName, dbUser, dbPass, {
  host: dbHost,
  port: dbPort,
  dialect: 'postgres',
  // Disable SQL logging by default. Set SEQUELIZE_LOG=true in .env to enable.
  logging: process.env.SEQUELIZE_LOG === 'true' ? console.log : false,
  // Add connection pool configuration for better performance
  pool: {
    max: 20,
    min: 5,
    acquire: 30000,
    idle: 10000
  },
  // Prevent connection string from appearing in error messages
  dialectOptions: {
    // SSL configuration if needed
    ssl: process.env.DB_SSL === 'true' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  }
});

// Test connection and handle errors safely (without exposing credentials)
sequelize.authenticate()
  .then(() => {
    if (process.env.SEQUELIZE_LOG === 'true') {
      console.log('✓ Database connection established successfully');
    }
  })
  .catch(err => {
    console.error('❌ Unable to connect to database:', err.message);
    console.error('   Check your database credentials and ensure PostgreSQL is running');
    // Don't log the full error stack in production as it may contain connection details
    if (process.env.NODE_ENV === 'development' && process.env.SEQUELIZE_LOG === 'true') {
      console.error('   Full error (dev mode):', err);
    }
  });

module.exports = sequelize;