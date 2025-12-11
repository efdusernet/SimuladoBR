/**
 * Environment Variable Validation Module
 * Validates required environment variables on startup
 * Prevents application from starting with missing or invalid configuration
 */

/**
 * Validates that required environment variables are present and valid
 * @throws {Error} If any required variable is missing or invalid
 */
function validateRequiredEnvVars() {
  const errors = [];

  // Database configuration
  const requiredDbVars = [
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'DB_HOST'
  ];

  requiredDbVars.forEach(varName => {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      errors.push(`${varName} is required but not set`);
    }
  });

  // Validate DB_PORT is a valid number
  const dbPort = process.env.DB_PORT;
  if (dbPort) {
    const portNum = Number(dbPort);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      errors.push('DB_PORT must be a valid port number (1-65535)');
    }
  }

  // JWT Secret validation
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.trim() === '') {
    errors.push('JWT_SECRET is required but not set');
  } else if (jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters for security');
  }

  // Email configuration (if SMTP is used)
  if (process.env.SMTP_HOST) {
    const requiredEmailVars = ['SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'];
    requiredEmailVars.forEach(varName => {
      const value = process.env[varName];
      if (!value || value.trim() === '') {
        errors.push(`${varName} is required when SMTP_HOST is set`);
      }
    });
  }

  // Base URLs validation
  const requiredUrls = ['APP_BASE_URL', 'FRONTEND_URL'];
  requiredUrls.forEach(varName => {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      errors.push(`${varName} is required but not set`);
    } else {
      try {
        new URL(value);
      } catch (e) {
        errors.push(`${varName} must be a valid URL`);
      }
    }
  });

  // Redis configuration validation (if Redis is enabled)
  if (process.env.USE_REDIS === 'true') {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || redisUrl.trim() === '') {
      errors.push('REDIS_URL is required when USE_REDIS=true');
    } else if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
      errors.push('REDIS_URL must start with redis:// or rediss://');
    }
  }

  // If any errors, fail startup
  if (errors.length > 0) {
    console.error('\n❌ ENVIRONMENT CONFIGURATION ERRORS:\n');
    errors.forEach((error, index) => {
      console.error(`  ${index + 1}. ${error}`);
    });
    console.error('\n💡 Please check your .env file and ensure all required variables are set.\n');
    
    throw new Error(`Environment validation failed: ${errors.length} error(s) found`);
  }

  console.log('✓ Environment variables validated successfully');
}

/**
 * Sanitizes a connection string by removing sensitive information
 * Used for safe logging without exposing credentials
 * @param {string} connectionString - The connection string to sanitize
 * @returns {string} Sanitized connection string
 */
function sanitizeConnectionString(connectionString) {
  if (!connectionString) return '[no connection string]';
  
  try {
    const url = new URL(connectionString);
    
    // Mask password if present
    if (url.password) {
      url.password = '***';
    }
    
    // Mask username partially (show first 2 chars)
    if (url.username && url.username.length > 2) {
      url.username = url.username.substring(0, 2) + '***';
    }
    
    return url.toString();
  } catch (e) {
    // If not a URL format, try to mask password in PostgreSQL format
    // postgres://user:password@host:port/database
    return connectionString.replace(/:([^@]+)@/, ':***@');
  }
}

/**
 * Returns safe database configuration info for logging
 * Excludes sensitive credentials
 * @returns {object} Safe config object
 */
function getSafeDbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || '[not set]',
    user: process.env.DB_USER ? maskSensitiveValue(process.env.DB_USER) : '[not set]',
    // Never include password
  };
}

/**
 * Masks sensitive values for safe logging
 * Shows first 2 characters, rest as asterisks
 * @param {string} value - Value to mask
 * @returns {string} Masked value
 */
function maskSensitiveValue(value) {
  if (!value || value.length <= 2) return '***';
  return value.substring(0, 2) + '***';
}

/**
 * Validates environment on module load (for database config)
 * Can be disabled by setting SKIP_ENV_VALIDATION=true (for scripts)
 */
function validateOnLoad() {
  if (process.env.SKIP_ENV_VALIDATION === 'true') {
    console.log('⚠️  Environment validation skipped (SKIP_ENV_VALIDATION=true)');
    return;
  }
  
  try {
    validateRequiredEnvVars();
  } catch (error) {
    // Re-throw to prevent application from starting
    throw error;
  }
}

module.exports = {
  validateRequiredEnvVars,
  sanitizeConnectionString,
  getSafeDbConfig,
  maskSensitiveValue,
  validateOnLoad
};
