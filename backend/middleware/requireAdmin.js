const db = require('../models');

// Resolves user from X-Session-Token header (email, NomeUsuario or id) and checks if has role 'admin'
module.exports = async function requireAdmin(req, res, next){
  try {
    // Accept token from header, body, query, or cookie for HTML GETs
    let token = (req.get('X-Session-Token') || (req.body && req.body.sessionToken) || req.query && (req.query.sessionToken || req.query.session || req.query.token) || '').toString().trim();
    if (!token && req.headers && typeof req.headers.cookie === 'string') {
      const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(kv => {
        const idx = kv.indexOf('=');
        const k = idx >= 0 ? kv.slice(0, idx).trim() : kv.trim();
        const v = idx >= 0 ? decodeURIComponent(kv.slice(idx + 1)) : '';
        return [k, v];
      }));
      if (cookies && cookies.sessionToken) token = cookies.sessionToken.trim();
    }
    
    token = (token || '').trim();
    if (!token) return res.status(401).json({ error: 'X-Session-Token required' });

    let user = null;
    if (/^\d+$/.test(token)) {
      user = await db.User.findByPk(Number(token));
    }
    if (!user) {
      const Op = db.Sequelize && db.Sequelize.Op;
      const where = Op ? { [Op.or]: [{ NomeUsuario: token }, { Email: token }] } : { NomeUsuario: token };
      user = await db.User.findOne({ where });
    }
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Check role membership (admin). If RBAC tables are missing, respond 403 instead of 500.
    try {
      const rows = await db.sequelize.query(
        'SELECT 1 FROM public.user_role ur JOIN public.role r ON r.id = ur.role_id WHERE ur.user_id = :uid AND r.slug = :slug AND (r.ativo = TRUE OR r.ativo IS NULL) LIMIT 1',
        { replacements: { uid: user.Id, slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT }
      );
      if (!rows || !rows.length) return res.status(403).json({ error: 'Admin role required' });
    } catch (err) {
      // Postgres missing relation error code is 42P01; also check message heuristics
      const code = (err && err.original && err.original.code) || err.code || '';
      const msg = (err && (err.message || err.toString())) || '';
      const missingTable = code === '42P01' || /relation .* does not exist/i.test(msg);
      if (missingTable) {
        console.warn('requireAdmin: RBAC tables missing; denying with 403');
        return res.status(403).json({ error: 'Admin role required' });
      }
      console.warn('requireAdmin: role check failed; denying with 403. Error:', msg);
      return res.status(403).json({ error: 'Admin role required' });
    }

    req.user = user;
    next();
  } catch (e) {
    console.error('requireAdmin error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
