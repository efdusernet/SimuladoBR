const db = require('../models');
const { logger, security } = require('../utils/logger');
const { unauthorized, forbidden, internalError } = require('./errors');
const { extractTokenFromRequest, verifyJwtAndGetActiveUser } = require('../utils/singleSession');

// Resolves user from X-Session-Token (id, NomeUsuario, Email or JWT) and checks for 'admin' role
module.exports = async function requireAdmin(req, res, next){
  try {
    const accept = String((req.headers && req.headers.accept) || '');
    const url = String(req.originalUrl || req.url || '');
    const isApiRequest = url.startsWith('/api/') || url.startsWith('/api/v1/');
    // IMPORTANT: browsers/fetch often send Accept: */* even for XHR.
    // Never treat /api/* as an HTML navigation; returning 302 to /login breaks client probes.
    const wantsHtml = !isApiRequest && req.method === 'GET' && (accept.includes('text/html') || accept.includes('*/*'));

    const token = extractTokenFromRequest(req);
    if (!token) {
      if (wantsHtml) return res.redirect('/login');
      return next(unauthorized('Session token required', 'SESSION_TOKEN_REQUIRED'));
    }

    const result = await verifyJwtAndGetActiveUser(token);
    if (!result.ok) {
      if (wantsHtml) return res.redirect('/login');
      if (result.status === 403) return next(forbidden(result.message, result.code));
      return next(unauthorized(result.message, result.code));
    }

    const user = result.user;

    // Check admin role membership
    try {
      const rows = await db.sequelize.query(
        'SELECT 1 FROM public.user_role ur JOIN public.role r ON r.id = ur.role_id WHERE ur.user_id = :uid AND r.slug = :slug AND (r.ativo = TRUE OR r.ativo IS NULL) LIMIT 1',
        { replacements: { uid: user.Id, slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT }
      );
      if (!rows || !rows.length) {
        security.authorizationFailure(req, 'admin_resource', 'access');
        if (wantsHtml) return res.redirect('/login');
        return next(forbidden('Admin role required', 'ADMIN_REQUIRED'));
      }
    } catch (err) {
      const code = (err && err.original && err.original.code) || err.code || '';
      const msg = (err && (err.message || err.toString())) || '';
      const missingTable = code === '42P01' || /relation .* does not exist/i.test(msg);
      if (missingTable) {
        logger.warn('requireAdmin: RBAC tables missing; denying with 403');
        security.authorizationFailure(req, 'admin_resource', 'rbac_tables_missing');
        if (wantsHtml) return res.redirect('/login');
        return next(forbidden('Admin role required', 'ADMIN_REQUIRED'));
      }
      logger.warn('requireAdmin: role check failed; denying with 403. Error:', msg);
      security.authorizationFailure(req, 'admin_resource', 'role_check_error');
      if (wantsHtml) return res.redirect('/login');
      return next(forbidden('Admin role required', 'ADMIN_REQUIRED'));
    }

    req.user = user;
    next();
  } catch (e) {
    logger.error('requireAdmin error:', e);
    if (req.method === 'GET') {
      const accept = String((req.headers && req.headers.accept) || '');
      const wantsHtml = accept.includes('text/html') || accept.includes('*/*');
      if (wantsHtml) return res.redirect('/login');
    }
    return next(internalError('Internal error'));
  }
}
