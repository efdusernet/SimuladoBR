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

    // Admin resolution policy (keep consistent with GET /api/users/me):
    // 1) Prefer RBAC role membership (slug=admin) when tables exist
    // 2) Fallback to configured ADMIN_EMAILS and legacy username conventions
    let isAdmin = false;
    let rbacChecked = false;
    try {
      const rows = await db.sequelize.query(
        'SELECT 1 FROM public.user_role ur JOIN public.role r ON r.id = ur.role_id WHERE ur.user_id = :uid AND r.slug = :slug AND (r.ativo = TRUE OR r.ativo IS NULL) LIMIT 1',
        { replacements: { uid: user.Id, slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT }
      );
      rbacChecked = true;
      isAdmin = !!(rows && rows.length);
    } catch (err) {
      const code = (err && err.original && err.original.code) || err.code || '';
      const msg = (err && (err.message || err.toString())) || '';
      const missingTable = code === '42P01' || /relation .* does not exist/i.test(msg);
      if (!missingTable) {
        logger.warn('requireAdmin: role check failed (fallback enabled). Error:', msg);
      }
      // Fall through to fallback policy
    }

    if (!isAdmin) {
      const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
      const emailLower = String(user.Email || '').toLowerCase();
      const nomeLower = String(user.NomeUsuario || '').toLowerCase();
      isAdmin = adminEmails.includes(emailLower) || nomeLower === 'admin' || nomeLower.startsWith('admin_');
    }

    if (!isAdmin) {
      const reason = rbacChecked ? 'access' : 'rbac_unavailable';
      security.authorizationFailure(req, 'admin_resource', reason);
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
