const { verifyJwt } = require('../services/jwt');

function authOptional() {
  return async function authOptionalMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !/^Bearer\s+/i.test(auth)) return next();

    try {
      const token = auth.replace(/^Bearer\s+/i, '').trim();
      const result = await verifyJwt(token);
      req.auth = result;
      return next();
    } catch (err) {
      const e = new Error('JWT inválido');
      e.status = 401;
      e.cause = err;
      return next(e);
    }
  };
}

module.exports = { authOptional };
