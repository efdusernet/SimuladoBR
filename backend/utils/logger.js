/**
 * Structured Logging System with Winston
 * Provides audit trail, security event monitoring, and request tracking
 */

const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

// Determine log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'info';
};

// Custom format for structured logging
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
  winston.format.json()
);

// Console format for development
// NOTE: include metadata() so extra fields (method/url/statusCode/etc) are visible.
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
  winston.format.printf(
    (info) => {
      const { timestamp, level, message, metadata } = info;
      let metaStr = '';
      
      if (metadata && Object.keys(metadata).length > 0) {
        // Extract important fields for console
        const { requestId, userId, email, ip, method, url, statusCode, duration } = metadata;
        const parts = [];
        
        if (requestId) parts.push(`reqId=${requestId}`);
        if (userId) parts.push(`userId=${userId}`);
        if (email) parts.push(`email=${email}`);
        if (ip) parts.push(`ip=${ip}`);
        if (method && url) parts.push(`${method} ${url}`);
        if (statusCode) parts.push(`status=${statusCode}`);
        if (duration !== undefined) parts.push(`${duration}ms`);
        
        if (parts.length > 0) {
          metaStr = ` [${parts.join(' | ')}]`;
        }
      }
      
      return `${timestamp} ${level}: ${message}${metaStr}`;
    }
  )
);

// Create transports
const transports = [
  // Console transport (always enabled)
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? customFormat : consoleFormat,
  }),
];

// File transports (production and when LOG_TO_FILE is enabled)
const shouldLogToFile = process.env.LOG_TO_FILE === 'true' || process.env.NODE_ENV === 'production';

if (shouldLogToFile) {
  const logsDir = path.join(__dirname, '../logs');
  
  // All logs
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: customFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    })
  );
  
  // Error logs only
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: customFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    })
  );
  
  // Security events only
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'security.log'),
      format: customFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 10, // Keep more security logs
    })
  );
  
  // Audit trail
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'audit.log'),
      format: customFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
  // Don't exit on uncaught errors
  exitOnError: false,
});

/**
 * Helper function to extract context from Express request
 */
function getRequestContext(req) {
  return {
    requestId: req.id || req.headers['x-request-id'],
    method: req.method,
    url: req.originalUrl || req.url,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers['user-agent'],
    userId: req.user?.Id || req.user?.id,
    email: req.user?.Email || req.user?.email,
  };
}

/**
 * Security event logger
 */
const security = {
  loginSuccess: (req, user) => {
    logger.info('Login successful', {
      ...getRequestContext(req),
      event: 'LOGIN_SUCCESS',
      userId: user.Id,
      email: user.Email,
      securityEvent: true,
    });
  },
  
  loginFailure: (req, email, reason) => {
    logger.warn('Login failed', {
      ...getRequestContext(req),
      event: 'LOGIN_FAILURE',
      email,
      reason,
      securityEvent: true,
    });
  },
  
  registrationSuccess: (req, user) => {
    logger.info('User registration successful', {
      ...getRequestContext(req),
      event: 'REGISTRATION_SUCCESS',
      userId: user.Id,
      email: user.Email,
      securityEvent: true,
    });
  },
  
  passwordResetRequest: (req, email) => {
    logger.info('Password reset requested', {
      ...getRequestContext(req),
      event: 'PASSWORD_RESET_REQUEST',
      email,
      securityEvent: true,
    });
  },
  
  passwordResetSuccess: (req, email) => {
    logger.info('Password reset successful', {
      ...getRequestContext(req),
      event: 'PASSWORD_RESET_SUCCESS',
      email,
      securityEvent: true,
    });
  },
  
  authorizationFailure: (req, resource, action) => {
    logger.warn('Authorization failed', {
      ...getRequestContext(req),
      event: 'AUTHORIZATION_FAILURE',
      resource,
      action,
      securityEvent: true,
    });
  },
  
  rateLimitExceeded: (req) => {
    logger.warn('Rate limit exceeded', {
      ...getRequestContext(req),
      event: 'RATE_LIMIT_EXCEEDED',
      securityEvent: true,
    });
  },
  
  csrfFailure: (req) => {
    logger.warn('CSRF validation failed', {
      ...getRequestContext(req),
      event: 'CSRF_FAILURE',
      securityEvent: true,
    });
  },
  
  suspiciousActivity: (req, description) => {
    logger.warn('Suspicious activity detected', {
      ...getRequestContext(req),
      event: 'SUSPICIOUS_ACTIVITY',
      description,
      securityEvent: true,
    });
  },
  
  tokenExpired: (req, email) => {
    logger.info('Token expired', {
      ...getRequestContext(req),
      event: 'TOKEN_EXPIRED',
      email,
      securityEvent: true,
    });
  },
  
  adminActionPerformed: (req, action, targetUserId) => {
    logger.info('Admin action performed', {
      ...getRequestContext(req),
      event: 'ADMIN_ACTION',
      action,
      targetUserId,
      securityEvent: true,
      auditEvent: true,
    });
  },
};

/**
 * Audit trail logger
 */
const audit = {
  examStarted: (req, examType, attemptId) => {
    logger.info('Exam started', {
      ...getRequestContext(req),
      event: 'EXAM_STARTED',
      examType,
      attemptId,
      auditEvent: true,
    });
  },
  
  examCompleted: (req, examType, attemptId, score) => {
    logger.info('Exam completed', {
      ...getRequestContext(req),
      event: 'EXAM_COMPLETED',
      examType,
      attemptId,
      score,
      auditEvent: true,
    });
  },
  
  examAbandoned: (req, examType, attemptId, reason) => {
    logger.info('Exam abandoned', {
      ...getRequestContext(req),
      event: 'EXAM_ABANDONED',
      examType,
      attemptId,
      reason,
      auditEvent: true,
    });
  },
  
  questionAnswered: (req, attemptId, questionId) => {
    logger.debug('Question answered', {
      ...getRequestContext(req),
      event: 'QUESTION_ANSWERED',
      attemptId,
      questionId,
      auditEvent: true,
    });
  },
  
  paymentInitiated: (req, userId, amount, paymentId) => {
    logger.info('Payment initiated', {
      ...getRequestContext(req),
      event: 'PAYMENT_INITIATED',
      userId,
      amount,
      paymentId,
      auditEvent: true,
    });
  },
  
  paymentCompleted: (req, userId, amount, paymentId) => {
    logger.info('Payment completed', {
      ...getRequestContext(req),
      event: 'PAYMENT_COMPLETED',
      userId,
      amount,
      paymentId,
      auditEvent: true,
    });
  },
  
  dataExported: (req, dataType, recordCount) => {
    logger.info('Data exported', {
      ...getRequestContext(req),
      event: 'DATA_EXPORTED',
      dataType,
      recordCount,
      auditEvent: true,
    });
  },
  
  userDataDeleted: (req, targetUserId) => {
    logger.warn('User data deleted', {
      ...getRequestContext(req),
      event: 'USER_DATA_DELETED',
      targetUserId,
      auditEvent: true,
    });
  },
};

/**
 * HTTP request logger
 */
function logRequest(req, res, duration) {
  const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
  
  logger[level]('HTTP Request', {
    ...getRequestContext(req),
    statusCode: res.statusCode,
    duration,
    contentLength: res.get('content-length'),
  });
}

/**
 * Error logger with stack trace
 */
function logError(error, req, context = {}) {
  logger.error(error.message || 'Unknown error', {
    ...getRequestContext(req),
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
    },
    ...context,
  });
}

module.exports = {
  logger,
  security,
  audit,
  logRequest,
  logError,
  getRequestContext,
};
