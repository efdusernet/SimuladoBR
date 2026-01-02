const { env } = require('../config/env');

function errorHandler() {
  // eslint-disable-next-line no-unused-vars
  return function errorHandlerMiddleware(err, req, res, next) {
    const status = Number(err && err.status) || 500;
    const msg = (err && err.message) ? String(err.message) : 'Erro interno';

    // eslint-disable-next-line no-console
    console.error('[chat-service] error', {
      requestId: req && req.id,
      status,
      message: msg,
    });

    const body = {
      ok: false,
      error: msg,
      requestId: req && req.id,
    };

    if (env.NODE_ENV !== 'production') {
      body.details = {
        name: err && err.name ? String(err.name) : null,
        stack: err && err.stack ? String(err.stack) : null,
      };
    }

    res.status(status).json(body);
  };
}

module.exports = { errorHandler };
