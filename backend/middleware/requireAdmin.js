const db = require('../models');
const sequelize = require('../config/database');

// Resolve user from X-Session-Token (same logic we use for exam flows)
async function resolveUserFromRequest(req){
  const sessionToken = (req.get('X-Session-Token') || req.body && req.body.sessionToken || '').trim();
  if (!sessionToken) return null;
  // Try numeric id first
  if (/^\d+$/.test(sessionToken)) {
    try { const u = await db.User.findByPk(Number(sessionToken)); if (u) return u; } catch(_){}
  }
  // Fallback: NomeUsuario or Email
  try {
    const Op = db.Sequelize && db.Sequelize.Op;
    const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
    const u = await db.User.findOne({ where });
    return u || null;
  } catch(_) { return null; }
}

module.exports = async function requireAdmin(req, res, next){
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'auth required' });
    const uid = Number(user.Id || user.id);
    if (!Number.isFinite(uid)) return res.status(401).json({ error: 'invalid user' });
    // Check role membership via raw SQL (fast)
    const rows = await sequelize.query(
      'SELECT 1 FROM public.user_role ur JOIN public.role r ON r.id = ur.role_id WHERE ur.user_id = :uid AND r.slug = :slug LIMIT 1',
      { replacements: { uid, slug: 'admin' }, type: sequelize.QueryTypes.SELECT }
    );
    if (!rows || !rows.length) return res.status(403).json({ error: 'admin only' });
    // Attach minimal identity
    req.adminUserId = uid;
    return next();
  } catch (e) {
    return res.status(500).json({ error: 'auth check failed' });
  }
};
