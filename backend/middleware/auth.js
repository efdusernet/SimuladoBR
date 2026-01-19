const { verifyJwtAndGetActiveUser } = require('../utils/singleSession');
const { unauthorized, forbidden, internalError } = require('./errors');

module.exports = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return next(unauthorized('Token necessário', 'JWT_REQUIRED'));

    const result = await verifyJwtAndGetActiveUser(token);
    if (!result.ok) {
      if (result.status === 403) return next(forbidden(result.message, result.code));
      return next(unauthorized(result.message, result.code));
    }

    // Keep previous behavior: req.user contains the JWT payload for downstream handlers
    req.user = result.decoded;
    next();
  } catch (e) {
    return next(internalError('Internal error'));
  }
};