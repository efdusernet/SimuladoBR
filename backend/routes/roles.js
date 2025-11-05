const express = require('express');
const router = express.Router();
const db = require('../models');
const requireAdmin = require('../middleware/requireAdmin');

async function resolveUser({ id, email, nomeUsuario }){
  let user = null;
  if (id && /^\d+$/.test(String(id))) {
    user = await db.User.findByPk(Number(id));
  }
  if (!user && email) {
    user = await db.User.findOne({ where: { Email: String(email).trim().toLowerCase() } });
  }
  if (!user && nomeUsuario) {
    user = await db.User.findOne({ where: { NomeUsuario: String(nomeUsuario).trim() } });
  }
  return user;
}

async function resolveRole({ roleId, roleSlug }){
  let role = null;
  if (roleId && /^\d+$/.test(String(roleId))) {
    role = await db.Role.findByPk(Number(roleId));
  }
  if (!role && roleSlug) {
    role = await db.Role.findOne({ where: { slug: String(roleSlug).trim().toLowerCase() } });
  }
  return role;
}

// All routes below require admin
router.use(requireAdmin);

// GET /api/roles -> list all roles (active by default)
router.get('/', async (_req, res) => {
  try {
    const rows = await db.Role.findAll({ where: { ativo: true }, order: [['slug', 'ASC']] });
    return res.json(rows);
  } catch (e) { return res.status(500).json({ error: 'Internal error' }); }
});

// GET /api/roles/user/:userId -> list user's roles
router.get('/user/:userId', async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'invalid userId' });
    const rows = await db.sequelize.query(
      'SELECT r.* FROM public.user_role ur JOIN public.role r ON r.id = ur.role_id WHERE ur.user_id = :uid ORDER BY r.slug ASC',
      { replacements: { uid: userId }, type: db.Sequelize.QueryTypes.SELECT }
    );
    return res.json(rows);
  } catch (e) { return res.status(500).json({ error: 'Internal error' }); }
});

// POST /api/roles/assign { userId|email|nomeUsuario, roleId|roleSlug }
router.post('/assign', async (req, res) => {
  try {
    const b = req.body || {};
    const user = await resolveUser({ id: b.userId, email: b.email, nomeUsuario: b.nomeUsuario });
    if (!user) return res.status(404).json({ error: 'user not found' });
    const role = await resolveRole({ roleId: b.roleId, roleSlug: b.roleSlug || b.role });
    if (!role) return res.status(404).json({ error: 'role not found' });

    const exists = await db.sequelize.query(
      'SELECT 1 FROM public.user_role WHERE user_id = :uid AND role_id = :rid LIMIT 1',
      { replacements: { uid: user.Id, rid: role.id }, type: db.Sequelize.QueryTypes.SELECT }
    );
    if (exists && exists.length) return res.json({ ok: true, already: true });
    await db.sequelize.query(
      'INSERT INTO public.user_role (user_id, role_id) VALUES (:uid, :rid)',
      { replacements: { uid: user.Id, rid: role.id }, type: db.Sequelize.QueryTypes.INSERT }
    );
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: 'Internal error' }); }
});

// POST /api/roles/remove { userId|email|nomeUsuario, roleId|roleSlug }
router.post('/remove', async (req, res) => {
  try {
    const b = req.body || {};
    const user = await resolveUser({ id: b.userId, email: b.email, nomeUsuario: b.nomeUsuario });
    if (!user) return res.status(404).json({ error: 'user not found' });
    const role = await resolveRole({ roleId: b.roleId, roleSlug: b.roleSlug || b.role });
    if (!role) return res.status(404).json({ error: 'role not found' });
    const del = await db.sequelize.query(
      'DELETE FROM public.user_role WHERE user_id = :uid AND role_id = :rid',
      { replacements: { uid: user.Id, rid: role.id }, type: db.Sequelize.QueryTypes.DELETE }
    );
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: 'Internal error' }); }
});

module.exports = router;
