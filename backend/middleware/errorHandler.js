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
  const code = err.code || (statusCode === 500 ? 'INTERNAL_ERROR' : 'ERROR');
  const message = err.message || 'Erro interno do servidor';

  if (isOperational) {
    logger.warn('Operational error', { code, statusCode, message, requestId: req.id, url: req.originalUrl, method: req.method });
  } else {
    logger.error('UNEXPECTED ERROR', { error: message, stack: err.stack, requestId: req.id, url: req.originalUrl, method: req.method });
  }

  const body = {
    success: false,
    code,
    message,
    requestId: req.id,
    timestamp: new Date().toISOString()
  };

  if (process.env.NODE_ENV === 'development' && err.stack) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

module.exports = { AppError, errorHandler };
