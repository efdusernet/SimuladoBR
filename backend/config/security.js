/**
 * Security Configuration Module
 * Validates and provides secure configuration values
 */

const crypto = require('crypto');

const { logger } = require('../utils/logger');
/**
 * Get and validate JWT secret from environment
 * @returns {string} Validated JWT secret
 * @throws {Error} Exits process if JWT_SECRET is invalid or missing
 */
function getJWTSecret() {
  const secret = process.env.JWT_SECRET;
  
  if (!secret) {
    logger.error('FATAL: JWT_SECRET environment variable not set!');
    logger.error('Please set JWT_SECRET in your environment variables.');
    logger.error('Generate a secure secret with: node -e "logger.info(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
  
  if (secret.length < 32) {
    logger.error('FATAL: JWT_SECRET must be at least 32 characters long');
    logger.error(`Current length: ${secret.length}`);
    logger.error('Generate a secure secret with: node -e "logger.info(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
  
  // Warn about weak secrets in production
  if (process.env.NODE_ENV === 'production') {
    const weakSecrets = ['segredo', 'dev-secret', 'secret', 'test', 'password', '123456'];
    if (weakSecrets.some(weak => secret.toLowerCase().includes(weak))) {
      logger.error('FATAL: JWT_SECRET appears to be a weak or default value in production!');
      logger.error('Please use a cryptographically secure random value.');
      process.exit(1);
    }
  }
  
  return secret;
}

/**
 * Generate a cryptographically secure random JWT secret
 * Use this for development or secret rotation
 * @returns {string} Hex-encoded 32-byte random secret
 */
function generateSecureSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate environment configuration on startup
 * Checks for required environment variables and security settings
 */
function validateEnvironment() {
  const required = ['JWT_SECRET'];
  const missing = required.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    logger.error('FATAL: Missing required environment variables:');
    missing.forEach(varName => logger.error(`  - ${varName}`));
    process.exit(1);
  }
  
  // Validate JWT secret
  getJWTSecret();
  
  logger.info('✓ Security configuration validated');
}

// Initialize and validate on module load
const jwtSecret = getJWTSecret();

module.exports = {
  jwtSecret,
  getJWTSecret,
  generateSecureSecret,
  validateEnvironment
};
