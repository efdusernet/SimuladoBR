const db = require('../models');
const sequelize = require('../config/database');

// Resolve user from token: header/body/query/cookie; supports id, NomeUsuario, Email
async function resolveUser(req){
  try {
    let token = (req.get('X-Session-Token') || (req.body && req.body.sessionToken) || (req.query && (req.query.sessionToken || req.query.session || req.query.token)) || '').toString().trim();
    if (!token && req.headers && typeof req.headers.cookie === 'string') {
      try {
        const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(kv => {
          const idx = kv.indexOf('=');
          const k = idx >= 0 ? kv.slice(0, idx).trim() : kv.trim();
          const v = idx >= 0 ? decodeURIComponent(kv.slice(idx + 1)) : '';
          return [k, v];
        }));
        if (cookies && cookies.sessionToken) token = cookies.sessionToken.trim();
      } catch(_){}
    }
    token = (token || '').trim();
    if (!token) return null;
    if (/^\d+$/.test(token)) {
      const u = await db.User.findByPk(Number(token));
      if (u) return u;
    }
    const Op = db.Sequelize && db.Sequelize.Op;
    const where = Op ? { [Op.or]: [{ NomeUsuario: token }, { Email: token }] } : { NomeUsuario: token };
    const u = await db.User.findOne({ where });
    return u || null;
  } catch(e){ return null; }
}

module.exports = async function requireAdmin(req, res, next){
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: 'auth required' });
    const uid = Number(user.Id || user.id);
    if (!Number.isFinite(uid)) return res.status(401).json({ error: 'invalid user' });
    // Check role membership (admin) allowing ativo null or true
    const rows = await sequelize.query(
      'SELECT 1 FROM public.user_role ur JOIN public.role r ON r.id = ur.role_id WHERE ur.user_id = :uid AND r.slug = :slug AND (r.ativo = TRUE OR r.ativo IS NULL) LIMIT 1',
      { replacements: { uid, slug: 'admin' }, type: sequelize.QueryTypes.SELECT }
    );
    if (!rows || !rows.length) return res.status(403).json({ error: 'Admin role required' });
    req.user = user;
    req.adminUserId = uid;
    return next();
  } catch (e) {
    console.error('requireAdmin error:', e);
    return res.status(500).json({ error: 'auth check failed' });
  }
};
