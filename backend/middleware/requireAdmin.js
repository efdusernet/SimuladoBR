const db = require('../models');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/security');
const { security } = require('../utils/logger');

// Resolves user from X-Session-Token (id, NomeUsuario, Email or JWT) and checks for 'admin' role
module.exports = async function requireAdmin(req, res, next){
  try {
    const accept = String((req.headers && req.headers.accept) || '');
    const wantsHtml = req.method === 'GET' && (accept.includes('text/html') || accept.includes('*/*'));

    // Accept token from cookie (preferred), header, body, query, or Authorization: Bearer
    let token = (req.cookies.sessionToken || req.get('X-Session-Token') || (req.body && req.body.sessionToken) || (req.query && (req.query.sessionToken || req.query.session || req.query.token)) || '').toString().trim();
    let authHeader = (req.headers && req.headers.authorization) ? req.headers.authorization.trim() : '';
    let bearerToken = '';
    if (authHeader && /^Bearer\s+/i.test(authHeader)) bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();

    token = (token || '').trim();
    bearerToken = (bearerToken || '').trim();
    if (!token && bearerToken) token = bearerToken;
    if (!token) {
      if (wantsHtml) return res.redirect('/login');
      return res.status(401).json({ error: 'Session token required' });
    }

    let user = null;
    // Try JWT first
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(token)) {
      try {
        const decoded = jwt.verify(token, jwtSecret);
        if (decoded && decoded.sub) {
          user = await db.User.findByPk(Number(decoded.sub));
        }
        if (!user && decoded && decoded.email) {
          user = await db.User.findOne({ where: { Email: decoded.email } });
        }
      } catch(_){ /* invalid jwt: fall through */ }
    }
    // Numeric id
    if (!user && /^\d+$/.test(token)) {
      user = await db.User.findByPk(Number(token));
    }
    // Username or email
    if (!user) {
      const Op = db.Sequelize && db.Sequelize.Op;
      const where = Op ? { [Op.or]: [{ NomeUsuario: token }, { Email: token }] } : { NomeUsuario: token };
      user = await db.User.findOne({ where });
    }
    if (!user) {
      if (wantsHtml) return res.redirect('/login');
      return res.status(401).json({ error: 'User not found' });
    }

    // Check admin role membership
    try {
      const rows = await db.sequelize.query(
        'SELECT 1 FROM public.user_role ur JOIN public.role r ON r.id = ur.role_id WHERE ur.user_id = :uid AND r.slug = :slug AND (r.ativo = TRUE OR r.ativo IS NULL) LIMIT 1',
        { replacements: { uid: user.Id, slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT }
      );
      if (!rows || !rows.length) {
        security.authorizationFailure(req, 'admin_resource', 'access');
        if (wantsHtml) return res.redirect('/login');
        return res.status(403).json({ error: 'Admin role required' });
      }
    } catch (err) {
      const code = (err && err.original && err.original.code) || err.code || '';
      const msg = (err && (err.message || err.toString())) || '';
      const missingTable = code === '42P01' || /relation .* does not exist/i.test(msg);
      if (missingTable) {
        logger.warn('requireAdmin: RBAC tables missing; denying with 403');
        security.authorizationFailure(req, 'admin_resource', 'rbac_tables_missing');
        if (wantsHtml) return res.redirect('/login');
        return res.status(403).json({ error: 'Admin role required' });
      }
      logger.warn('requireAdmin: role check failed; denying with 403. Error:', msg);
      security.authorizationFailure(req, 'admin_resource', 'role_check_error');
      if (wantsHtml) return res.redirect('/login');
      return res.status(403).json({ error: 'Admin role required' });
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
    return res.status(500).json({ error: 'Internal error' });
  }
}
