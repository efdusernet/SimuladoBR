/**
 * Controlled Logging System
 * Prevents performance overhead and information disclosure in production
 * 
 * Usage:
 *   import { logger } from './utils/logger.js';
 *   logger.debug('Debug message', data);
 *   logger.info('Info message', data);
 *   logger.warn('Warning message', data);
 *   logger.error('Error message', error);
 * 
 * Environment detection:
 *   - Development: All logs enabled
 *   - Production: Only errors enabled (or completely disabled based on LOG_LEVEL)
 * 
 * Configuration via localStorage:
 *   localStorage.setItem('LOG_LEVEL', 'debug'); // 'debug', 'info', 'warn', 'error', 'none'
 */

(function(window) {
  'use strict';

  // Log levels (higher number = more severe)
  const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
  };

  // Detect environment: production if hostname is not localhost/127.0.0.1
  const isProduction = () => {
    const hostname = window.location.hostname;
    return !(hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '');
  };

  // Get configured log level from localStorage or environment
  const getConfiguredLevel = () => {
    try {
      const stored = localStorage.getItem('LOG_LEVEL');
      if (stored && LOG_LEVELS.hasOwnProperty(stored.toUpperCase())) {
        return LOG_LEVELS[stored.toUpperCase()];
      }
    } catch (e) {
      // localStorage might not be available
    }

    // Default levels based on environment
    return isProduction() ? LOG_LEVELS.ERROR : LOG_LEVELS.DEBUG;
  };

  let currentLevel = getConfiguredLevel();

  // Core logging function with level check
  const log = (level, levelName, ...args) => {
    if (level < currentLevel) {
      return; // Skip if below configured level
    }

    // In production, sanitize sensitive data
    if (isProduction() && args.length > 0) {
      args = args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          // Remove sensitive fields from objects
          const sanitized = { ...arg };
          const sensitiveKeys = ['password', 'token', 'senha', 'senhaHash', 'sessionToken', 'jwt', 'authorization'];
          sensitiveKeys.forEach(key => {
            if (key in sanitized) {
              sanitized[key] = '[REDACTED]';
            }
          });
          return sanitized;
        }
        return arg;
      });
    }

    // Use appropriate console method
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${levelName}]`;

    try {
      switch (level) {
        case LOG_LEVELS.DEBUG:
          console.debug(prefix, ...args);
          break;
        case LOG_LEVELS.INFO:
          console.info(prefix, ...args);
          break;
        case LOG_LEVELS.WARN:
          console.warn(prefix, ...args);
          break;
        case LOG_LEVELS.ERROR:
          console.error(prefix, ...args);
          break;
      }
    } catch (e) {
      // Fail silently if console is not available
    }
  };

  // Public API
  const logger = {
    debug: (...args) => log(LOG_LEVELS.DEBUG, 'DEBUG', ...args),
    info: (...args) => log(LOG_LEVELS.INFO, 'INFO', ...args),
    warn: (...args) => log(LOG_LEVELS.WARN, 'WARN', ...args),
    error: (...args) => log(LOG_LEVELS.ERROR, 'ERROR', ...args),

    // Utility to change log level at runtime
    setLevel: (levelName) => {
      const upperLevel = levelName.toUpperCase();
      if (LOG_LEVELS.hasOwnProperty(upperLevel)) {
        currentLevel = LOG_LEVELS[upperLevel];
        try {
          localStorage.setItem('LOG_LEVEL', upperLevel);
        } catch (e) {
          // Ignore storage errors
        }
        logger.info(`Log level changed to ${upperLevel}`);
      } else {
        console.error(`Invalid log level: ${levelName}. Valid levels:`, Object.keys(LOG_LEVELS));
      }
    },

    // Get current level
    getLevel: () => {
      return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === currentLevel);
    },

    // Check if a level is enabled
    isEnabled: (levelName) => {
      const upperLevel = levelName.toUpperCase();
      return LOG_LEVELS[upperLevel] >= currentLevel;
    }
  };

  // Replace global console methods in production to prevent accidental logging
  if (isProduction() && currentLevel >= LOG_LEVELS.ERROR) {
    const noop = () => {};
    
    // Store original methods (in case needed for debugging)
    window.__console = {
      log: console.log,
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error
    };

    // Override with noops (except error)
    console.log = noop;
    console.debug = noop;
    console.info = noop;
    console.warn = noop;
    // Keep console.error for critical errors
  }

  // Expose logger globally
  window.logger = logger;

  // Also support ES6 module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { logger };
  }

})(typeof window !== 'undefined' ? window : global);
