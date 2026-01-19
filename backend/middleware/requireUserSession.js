// Lightweight user session resolver for read-only access.
// Enforces single active session per user (JWT must contain sid matching user_active_session).
// Returns 401/403 when token/user not found or session revoked. Never grants admin-specific capabilities.
const { unauthorized, forbidden, internalError } = require('./errors');
const { extractTokenFromRequest, verifyJwtAndGetActiveUser } = require('../utils/singleSession');

module.exports = async function requireUserSession(req, res, next){
  try {
    const token = extractTokenFromRequest(req);
    const result = await verifyJwtAndGetActiveUser(token);
    if (!result.ok) {
      if (result.status === 403) return next(forbidden(result.message, result.code));
      return next(unauthorized(result.message, result.code));
    }

    const user = result.user;
    req.user = { id: user.Id || user.id, nome: user.NomeUsuario || user.Nome || null };
    next();
  } catch (e) {
    console.error('requireUserSession error:', e);
    return next(internalError('Internal error'));
  }
};
