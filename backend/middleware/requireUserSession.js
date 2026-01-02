// Lightweight user session resolver for read-only access.
// Resolves user from X-Session-Token (id, NomeUsuario or Email) and proceeds without role checks.
// Returns 401 when token/user not found. Never grants admin-specific capabilities.
const db = require('../models');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/security');

module.exports = async function requireUserSession(req, res, next){
  try {
    // Accept token from cookie (preferred), header, body, query, or Authorization: Bearer
    let token = (req.cookies.sessionToken || req.get('X-Session-Token') || (req.body && req.body.sessionToken) || req.query && (req.query.sessionToken || req.query.session || req.query.token) || '').toString().trim();
    // Accept Authorization: Bearer <jwt> as alternative session token
    let authHeader = (req.headers && req.headers.authorization) ? req.headers.authorization.trim() : '';
    let bearerToken = '';
    if (authHeader && /^Bearer\s+/i.test(authHeader)) bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    token = (token || '').trim();
    bearerToken = (bearerToken || '').trim();
    if (!token && bearerToken) token = bearerToken; // prefer explicit sessionToken but allow pure JWT
    if (!token) return res.status(401).json({ error: 'Session token required' });

    let user = null;
    // If looks like JWT try decode first
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(token)) {
      try {
        const decoded = jwt.verify(token, jwtSecret);
        if (decoded && decoded.sub) {
          user = await db.User.findByPk(Number(decoded.sub));
        }
        if (!user && decoded && decoded.email) {
          user = await db.User.findOne({ where: { Email: decoded.email } });
        }
      } catch(_){ /* ignore invalid jwt */ }
    }
    // Legacy numeric id
    if (!user && /^\d+$/.test(token)) {
      user = await db.User.findByPk(Number(token));
    }
    // Legacy username/email lookup
    if (!user) {
      const Op = db.Sequelize && db.Sequelize.Op;
      const where = Op ? { [Op.or]: [{ NomeUsuario: token }, { Email: token }] } : { NomeUsuario: token };
      user = await db.User.findOne({ where });
    }
    if (!user) return res.status(401).json({ error: 'User not found' });

    req.user = { id: user.Id || user.id, nome: user.NomeUsuario || user.Nome || null };
    next();
  } catch (e) {
    console.error('requireUserSession error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
};
