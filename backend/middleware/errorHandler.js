const { logger } = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

function errorHandler(err, req, res, next) {
  const isOperational = err.isOperational === true;
  const statusCode = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
  const code = err.code || (
    statusCode === 400 ? 'BAD_REQUEST' :
    statusCode === 401 ? 'UNAUTHORIZED' :
    statusCode === 403 ? 'FORBIDDEN' :
    statusCode === 404 ? 'NOT_FOUND' :
    statusCode === 409 ? 'CONFLICT' :
    statusCode === 422 ? 'UNPROCESSABLE_ENTITY' :
    statusCode === 429 ? 'TOO_MANY_REQUESTS' :
    statusCode === 503 ? 'SERVICE_UNAVAILABLE' :
    statusCode === 500 ? 'INTERNAL_ERROR' :
    'ERROR'
  );
  const message = err.message || 'Erro interno do servidor';

  if (isOperational) {
    logger.warn('Operational error', {
      code,
      statusCode,
      message,
      details: err.details,
      requestId: req.id,
      url: req.originalUrl,
      method: req.method
    });
  } else {
    logger.error('UNEXPECTED ERROR', { error: message, stack: err.stack, requestId: req.id, url: req.originalUrl, method: req.method });
  }

  const body = {
    success: false,
    code,
    message,
    // Backward compatibility: many callers historically looked for `error`.
    error: message,
    requestId: req.id,
    timestamp: new Date().toISOString()
  };

  if (process.env.NODE_ENV === 'development' && err.stack) {
    body.stack = err.stack;
  }

  // Always include validation-ish details (safe to expose), and expose all details in dev.
  if (err && err.details !== undefined) {
    const exposeAlways = statusCode === 400 || statusCode === 422;
    if (exposeAlways || process.env.NODE_ENV === 'development') {
      body.details = err.details;
      // For legacy clients expecting `errors` at top-level (validation middleware).
      if (err.details && err.details.errors && Array.isArray(err.details.errors)) {
        body.errors = err.details.errors;
      }
    }
  }

  res.status(statusCode).json(body);
}

module.exports = { AppError, errorHandler };
