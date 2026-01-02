const { randomUUID } = require('crypto');

function requestId() {
  return function requestIdMiddleware(req, res, next) {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}

module.exports = { requestId };
