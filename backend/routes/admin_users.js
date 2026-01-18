const express = require('express');
const router = express.Router();
const db = require('../models');
const requireAdmin = require('../middleware/requireAdmin');
const bcrypt = require('bcryptjs');
const { badRequest, notFound, internalError } = require('../middleware/errors');

// Explicitly set bcrypt rounds for password hashing security
const BCRYPT_ROUNDS = 12;

// GET /api/admin/users
// Lista usuários para seleção administrativa (Id, Nome, NomeUsuario)
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const offset = parseInt(req.query.offset) || 0;
    const users = await db.User.findAll({
      attributes: ['Id', 'Nome', 'NomeUsuario'],
      limit,
      offset,
      order: [['Id', 'DESC']]
    });
    res.json(users);
  } catch (e) {
    console.error('[admin_users][LIST] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_USERS_LIST_ERROR', { error: e && e.message }));
  }
});

// GET /api/admin/users/search?q=...
// Busca usuários por Nome / NomeUsuario / Email (e Id se numérico) para UIs administrativas.
// IMPORTANT: must be declared BEFORE '/:id' to avoid being captured by the param route.
router.get('/search', requireAdmin, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    if (!q) return res.json({ q: '', count: 0, items: [] });

    const Op = db.Sequelize && db.Sequelize.Op;
    const whereOr = [];

    if (/^\d+$/.test(q)) {
      const id = Number(q);
      if (Number.isFinite(id) && id > 0) whereOr.push({ Id: id });
    }

    if (Op) {
      // Escape % and _ so the query behaves as a literal contains-search.
      const like = '%' + q.replace(/[%_]/g, (m) => '\\' + m) + '%';
      whereOr.push({ Nome: { [Op.iLike]: like } });
      whereOr.push({ NomeUsuario: { [Op.iLike]: like } });
      whereOr.push({ Email: { [Op.iLike]: like } });
    }

    const where = Op ? { [Op.or]: whereOr } : undefined;
    if (!where) return res.json({ q, count: 0, items: [] });

    const users = await db.User.findAll({
      attributes: ['Id', 'Nome', 'NomeUsuario', 'Email'],
      where,
      limit,
      order: [['Id', 'DESC']]
    });

    return res.json({ q, count: users.length, items: users });
  } catch (e) {
    console.error('[admin_users][SEARCH] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_USERS_SEARCH_ERROR', { error: e && e.message }));
  }
});

// GET /api/admin/users/:id/insights-snapshots?days=90&includePayload=0
// Lista snapshots diários gravados a partir do /api/ai/insights (somente para usuários pagantes).
router.get('/:id/insights-snapshots', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params && req.params.id);
    if (!Number.isFinite(id) || id <= 0) return next(badRequest('User id inválido', 'INVALID_USER_ID'));

    const daysRaw = parseInt(req.query.days, 10);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 365) : 90;

    const includePayload = String(req.query.includePayload || '0').trim() === '1';

    // Compute start date in JS to keep SQL simple.
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - (days - 1));
    const startYmd = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

    const cols = [
      'snapshot_date',
      'period_days',
      'exam_date_raw',
      'days_to_exam',
      'readiness_score',
      'consistency_score',
      'avg_score_percent',
      'completion_rate',
      'abandon_rate',
      'trend_delta_score7d',
      'pass_probability_percent',
      'pass_probability_overall_percent',
      'pass_probability_threshold_percent',
      'ind13_dominio_id',
      'ind13_min_total',
      'created_at',
      'updated_at',
    ];
    if (includePayload) cols.push('payload');

    const rows = await db.sequelize.query(
      `
        SELECT ${cols.join(', ')}
        FROM public.user_daily_snapshot
        WHERE user_id = :uid
          AND snapshot_date >= :startDate::date
        ORDER BY snapshot_date DESC
      `,
      {
        replacements: { uid: id, startDate: startYmd },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );

    return res.json({ userId: id, days, count: rows.length, items: rows });
  } catch (e) {
    console.error('[admin_users][INSIGHTS_SNAPSHOTS] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_USERS_INSIGHTS_SNAPSHOTS_ERROR', { error: e && e.message }));
  }
});

// GET /api/admin/users/:id
// Lookup a single user for admin UIs (Id + Nome + NomeUsuario + Email)
// Note: do not use regex params here because the current router/path-to-regexp version rejects them.
router.get('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params && req.params.id);
    if (!Number.isFinite(id) || id <= 0) return next(badRequest('User id inválido', 'INVALID_USER_ID'));

    const user = await db.User.findByPk(id, { attributes: ['Id', 'Nome', 'NomeUsuario', 'Email'] });
    if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));

    return res.json(user);
  } catch (e) {
    console.error('[admin_users][GET] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_USERS_GET_ERROR', { error: e && e.message }));
  }
});

/**
 * POST /api/admin/users/reset-password
 * Admin endpoint to reset any user's password by email
 * Body: { email, newPassword } where newPassword is SHA-256 hash from client
 */
router.post('/reset-password', requireAdmin, async (req, res, next) => {
  try {
    const { email, newPassword } = req.body || {};

    if (!email || !newPassword) {
      return next(badRequest('Email e nova senha obrigatórios', 'EMAIL_AND_PASSWORD_REQUIRED'));
    }

    const targetUser = await db.User.findOne({ 
      where: { Email: email.toLowerCase().trim() } 
    });
    
    if (!targetUser) {
      return next(notFound('Usuário não encontrado com este email', 'USER_NOT_FOUND'));
    }

    // newPassword is already SHA-256 hashed from client, now bcrypt it
    const bcryptHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    
    targetUser.SenhaHash = bcryptHash;
    targetUser.DataAlteracao = new Date();
    await targetUser.save();

    return res.json({ 
      message: 'Senha resetada com sucesso', 
      email: targetUser.Email,
      userId: targetUser.Id 
    });
  } catch (err) {
    console.error('[admin_users][RESET_PASSWORD] error:', err);
    return next(internalError('Erro interno ao resetar senha', 'ADMIN_USERS_RESET_PASSWORD_ERROR', { error: err && err.message }));
  }
});

module.exports = router;