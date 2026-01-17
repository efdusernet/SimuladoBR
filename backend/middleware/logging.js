/**
 * Logging Middleware
 * Adds request tracking and automatic HTTP logging
 */

const { logRequest, logError } = require('../utils/logger');

/**
 * Request logging middleware
 * Logs all HTTP requests with duration and status
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();
  
  // Log request completion
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logRequest(req, res, duration);
  });
  
  next();
}

/**
 * Error logging middleware
 * Should be added after all routes
 */
function errorLogger(err, req, res, next) {
  const statusCode = Number(err && (err.statusCode || err.status)) || 500;
  const isOperational = err && err.isOperational === true;

  // Avoid double-logging and avoid marking expected auth/validation failures as errors.
  // Centralized errorHandler already logs operational errors at warn-level.
  if (!isOperational || statusCode >= 500) {
    logError(err, req);
  }
  next(err);
}

module.exports = {
  requestLogger,
  errorLogger,
};
