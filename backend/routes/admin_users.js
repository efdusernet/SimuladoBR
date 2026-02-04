const express = require('express');
const router = express.Router();
const db = require('../models');
const requireAdmin = require('../middleware/requireAdmin');
const bcrypt = require('bcryptjs');
const { logger } = require('../utils/logger');
const { badRequest, notFound, internalError, conflict } = require('../middleware/errors');
const { authSchemas, adminSchemas, validate } = require('../middleware/validation');

async function getAdminRoleIdOrCreate(){
  // Returns role id for slug='admin'. Creates the role if missing.
  const rows = await db.sequelize.query(
    'SELECT id FROM public.role WHERE slug = :slug LIMIT 1',
    { replacements: { slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT }
  );
  if (rows && rows[0] && rows[0].id) return Number(rows[0].id);

  // Create with minimal defaults; mirrors backend/sql/014_seed_roles_admin.sql
  const created = await db.sequelize.query(
    'INSERT INTO public.role (slug, nome, ativo) VALUES (:slug, :nome, TRUE) ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id',
    { replacements: { slug: 'admin', nome: 'Administrador' }, type: db.Sequelize.QueryTypes.SELECT }
  );
  if (created && created[0] && created[0].id) return Number(created[0].id);

  // Fallback re-select
  const rows2 = await db.sequelize.query(
    'SELECT id FROM public.role WHERE slug = :slug LIMIT 1',
    { replacements: { slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT }
  );
  if (rows2 && rows2[0] && rows2[0].id) return Number(rows2[0].id);
  throw new Error('Admin role id not found');
}

function isMissingRelationError(err){
  const code = (err && err.original && err.original.code) || err.code || '';
  const msg = (err && (err.message || err.toString())) || '';
  return code === '42P01' || /relation .* does not exist/i.test(msg);
}

async function checkAdminRbac(uid){
  // Returns { rbacAvailable, isAdminRbac }
  try {
    const rows = await db.sequelize.query(
      'SELECT 1 FROM public.user_role ur JOIN public.role r ON r.id = ur.role_id WHERE ur.user_id = :uid AND r.slug = :slug AND (r.ativo = TRUE OR r.ativo IS NULL) LIMIT 1',
      { replacements: { uid, slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT }
    );
    return { rbacAvailable: true, isAdminRbac: !!(rows && rows.length) };
  } catch (err) {
    if (isMissingRelationError(err)) return { rbacAvailable: false, isAdminRbac: false };
    throw err;
  }
}

function checkAdminFallback(user){
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const emailLower = String(user && user.Email || '').toLowerCase();
  const nomeLower = String(user && user.NomeUsuario || '').toLowerCase();
  return adminEmails.includes(emailLower) || nomeLower === 'admin' || nomeLower.startsWith('admin_');
}

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

// POST /api/admin/users
// Cria usuário via admin (sem rate-limit). Aceita os mesmos campos do register público.
// Body: { Email, SenhaHash (sha256 hex), Nome?, NomeUsuario? }
router.post('/', requireAdmin, validate(adminSchemas.createUser), async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = String(body.Email || '').trim().toLowerCase();

    const requestedUsernameRaw = (body.NomeUsuario == null) ? '' : String(body.NomeUsuario);
    const requestedUsername = requestedUsernameRaw.trim().toLowerCase();
    const nome = body.Nome == null ? null : String(body.Nome);

    // Uniqueness checks
    const existing = await db.User.findOne({ where: { Email: email } });
    if (existing) return next(conflict('Usuário com este e-mail já existe', 'EMAIL_ALREADY_EXISTS'));

    if (requestedUsername) {
      let existingByUsername = null;
      if (db.Sequelize && db.Sequelize.Op) {
        const OpLocal = db.Sequelize.Op;
        existingByUsername = await db.User.findOne({ where: { NomeUsuario: { [OpLocal.iLike]: requestedUsername } } });
      } else {
        existingByUsername = await db.User.findOne({ where: { NomeUsuario: requestedUsername } });
      }
      if (existingByUsername) return next(conflict('Nome de usuário já existe', 'USERNAME_ALREADY_EXISTS'));
    }

    // Prefer requested username, fallback to email.
    const nomeUsuario = requestedUsername || email;

    // Admin can choose to keep user blocked (email not confirmed) or unlocked.
    const emailConfirmado = (body.EmailConfirmado != null) ? !!body.EmailConfirmado : true;

    // SenhaHash is client-side SHA-256 hex; bcrypt it.
    const senhaHashToStore = await bcrypt.hash(String(body.SenhaHash), BCRYPT_ROUNDS);

    const created = await db.User.create({
      AccessFailedCount: 0,
      Email: email,
      // Admin-created users are immediately usable by default (unless explicitly set otherwise).
      EmailConfirmado: emailConfirmado,
      BloqueioAtivado: true,
      FimBloqueio: null,
      NomeUsuario: nomeUsuario,
      SenhaHash: senhaHashToStore,
      NumeroTelefone: null,
      Nome: nome,
      ForcarLogin: null,
      DataCadastro: new Date(),
      DataAlteracao: new Date(),
      Excluido: false,
    });

    return res.status(201).json({
      Id: created.Id,
      Nome: created.Nome,
      NomeUsuario: created.NomeUsuario,
      Email: created.Email,
      EmailConfirmado: created.EmailConfirmado,
      Excluido: created.Excluido,
      DataCadastro: created.DataCadastro ? new Date(created.DataCadastro).toISOString() : null,
      DataAlteracao: created.DataAlteracao ? new Date(created.DataAlteracao).toISOString() : null,
    });
  } catch (e) {
    console.error('[admin_users][CREATE] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_USERS_CREATE_ERROR', { error: e && e.message }));
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

// PUT /api/admin/users/:id
// Atualiza campos básicos do usuário (sem senha).
// Body aceita: { Nome?, NomeUsuario?, Email?, EmailConfirmado?, Excluido? }
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params && req.params.id);
    if (!Number.isFinite(id) || id <= 0) return next(badRequest('User id inválido', 'INVALID_USER_ID'));

    const user = await db.User.findByPk(id);
    if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));

    const body = req.body || {};

    let email = undefined;
    if (body.Email != null) email = String(body.Email || '').trim().toLowerCase();

    let nomeUsuario = undefined;
    if (body.NomeUsuario != null) nomeUsuario = String(body.NomeUsuario || '').trim().toLowerCase();

    const nome = (body.Nome != null) ? (body.Nome === '' ? null : String(body.Nome)) : undefined;
    const emailConfirmado = (body.EmailConfirmado != null) ? !!body.EmailConfirmado : undefined;
    const excluido = (body.Excluido != null) ? !!body.Excluido : undefined;

    if (email !== undefined) {
      if (!email) return next(badRequest('Email inválido', 'INVALID_EMAIL'));
      const existing = await db.User.findOne({ where: { Email: email } });
      if (existing && Number(existing.Id) !== Number(user.Id)) {
        return next(conflict('Usuário com este e-mail já existe', 'EMAIL_ALREADY_EXISTS'));
      }
      user.Email = email;
    }

    if (nomeUsuario !== undefined) {
      // Allow clearing username, but keep at least email as identifier.
      const candidate = String(nomeUsuario || '').trim().toLowerCase();
      if (candidate) {
        let existingByUsername = null;
        if (db.Sequelize && db.Sequelize.Op) {
          const OpLocal = db.Sequelize.Op;
          existingByUsername = await db.User.findOne({ where: { NomeUsuario: { [OpLocal.iLike]: candidate } } });
        } else {
          existingByUsername = await db.User.findOne({ where: { NomeUsuario: candidate } });
        }
        if (existingByUsername && Number(existingByUsername.Id) !== Number(user.Id)) {
          return next(conflict('Nome de usuário já existe', 'USERNAME_ALREADY_EXISTS'));
        }
        user.NomeUsuario = candidate;
      } else {
        user.NomeUsuario = null;
      }
    }

    if (nome !== undefined) user.Nome = nome;
    if (emailConfirmado !== undefined) user.EmailConfirmado = emailConfirmado;
    if (excluido !== undefined) user.Excluido = excluido;
    user.DataAlteracao = new Date();
    await user.save();

    return res.json({
      Id: user.Id,
      Nome: user.Nome,
      NomeUsuario: user.NomeUsuario,
      Email: user.Email,
      EmailConfirmado: user.EmailConfirmado,
      Excluido: user.Excluido,
      DataCadastro: user.DataCadastro ? new Date(user.DataCadastro).toISOString() : null,
      DataAlteracao: user.DataAlteracao ? new Date(user.DataAlteracao).toISOString() : null,
    });
  } catch (e) {
    console.error('[admin_users][PUT] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_USERS_PUT_ERROR', { error: e && e.message }));
  }
});

// DELETE /api/admin/users/:id
// Soft-delete: marca Excluido=true.
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params && req.params.id);
    if (!Number.isFinite(id) || id <= 0) return next(badRequest('User id inválido', 'INVALID_USER_ID'));

    const user = await db.User.findByPk(id);
    if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));

    user.Excluido = true;
    user.DataAlteracao = new Date();
    await user.save();
    return res.json({ ok: true, Id: user.Id, Excluido: true });
  } catch (e) {
    console.error('[admin_users][DELETE] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_USERS_DELETE_ERROR', { error: e && e.message }));
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

// GET /api/admin/users/:id/premium-expires-at
// Lê a data de expiração do Premium (PremiumExpiresAt) para um usuário.
router.get('/:id/premium-expires-at', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params && req.params.id);
    if (!Number.isFinite(id) || id <= 0) return next(badRequest('User id inválido', 'INVALID_USER_ID'));

    const user = await db.User.findByPk(id, { attributes: ['Id', 'PremiumExpiresAt'] });
    if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));

    return res.json({
      Id: user.Id,
      PremiumExpiresAt: user.PremiumExpiresAt ? new Date(user.PremiumExpiresAt).toISOString() : null,
    });
  } catch (e) {
    console.error('[admin_users][PREMIUM_EXPIRES_AT_GET] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_USERS_PREMIUM_EXPIRES_AT_GET_ERROR', { error: e && e.message }));
  }
});

// PUT /api/admin/users/:id/premium-expires-at
// Atualiza a data de expiração do Premium (PremiumExpiresAt) para um usuário.
// Body: { PremiumExpiresAt: string|null } (aceita ISO 8601; null limpa o campo)
router.put('/:id/premium-expires-at', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params && req.params.id);
    if (!Number.isFinite(id) || id <= 0) return next(badRequest('User id inválido', 'INVALID_USER_ID'));

    const user = await db.User.findByPk(id, { attributes: ['Id', 'PremiumExpiresAt', 'DataAlteracao'] });
    if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));

    const body = req.body || {};
    const raw = (body.PremiumExpiresAt ?? body.premiumExpiresAt) ?? null;

    let value = null;
    if (raw != null && String(raw).trim() !== '') {
      const dt = new Date(String(raw).trim());
      if (!Number.isFinite(dt.getTime())) {
        return next(badRequest('PremiumExpiresAt inválido (use ISO 8601 ou null)', 'INVALID_PREMIUM_EXPIRES_AT'));
      }
      value = dt;
    }

    user.PremiumExpiresAt = value;
    user.DataAlteracao = new Date();
    await user.save();

    return res.json({
      Id: user.Id,
      PremiumExpiresAt: user.PremiumExpiresAt ? new Date(user.PremiumExpiresAt).toISOString() : null,
    });
  } catch (e) {
    console.error('[admin_users][PREMIUM_EXPIRES_AT_PUT] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_USERS_PREMIUM_EXPIRES_AT_PUT_ERROR', { error: e && e.message }));
  }
});

// GET /api/admin/users/:id
// Lookup a single user for admin UIs (Id + Nome + NomeUsuario + Email)
// Note: do not use regex params here because the current router/path-to-regexp version rejects them.
router.get('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params && req.params.id);
    if (!Number.isFinite(id) || id <= 0) return next(badRequest('User id inválido', 'INVALID_USER_ID'));

    const user = await db.User.findByPk(id, { attributes: ['Id', 'Nome', 'NomeUsuario', 'Email', 'EmailConfirmado', 'Excluido', 'DataCadastro', 'DataAlteracao'] });
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

    // Best-effort audit log
    try {
      if (db.UserPasswordChangeLog && typeof db.UserPasswordChangeLog.create === 'function') {
        await db.UserPasswordChangeLog.create({
          TargetUserId: targetUser.Id,
          ActorUserId: (req.user && req.user.Id) ? req.user.Id : null,
          Origin: 'admin_reset_password',
          Ip: req.ip || null,
          UserAgent: (req.get('user-agent') || '').slice(0, 4000) || null,
          ChangedAt: new Date()
        });
      }
    } catch (e) {
      const msg = (e && (e.message || e.toString())) || 'unknown error';
      console.warn('[user_password_change_log] failed to write audit log:', msg);
    }

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

// GET /api/admin/users/:id/admin-status
// Read admin status (RBAC + fallback). Useful for admin setup UIs.
router.get('/:id/admin-status', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params && req.params.id);
    if (!Number.isFinite(id) || id <= 0) return next(badRequest('User id inválido', 'INVALID_USER_ID'));

    const user = await db.User.findByPk(id, { attributes: ['Id', 'Nome', 'NomeUsuario', 'Email'] });
    if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));

    const rbac = await checkAdminRbac(user.Id);
    const isAdminFallback = checkAdminFallback(user);
    const isAdminEffective = (rbac.rbacAvailable && rbac.isAdminRbac) || isAdminFallback;

    return res.json({
      user: { Id: user.Id, Nome: user.Nome, NomeUsuario: user.NomeUsuario, Email: user.Email },
      rbacAvailable: rbac.rbacAvailable,
      isAdminRbac: rbac.isAdminRbac,
      isAdminFallback,
      isAdminEffective,
      note: rbac.rbacAvailable ? null : 'RBAC tables not available. Admin status may rely on ADMIN_EMAILS or legacy username conventions.'
    });
  } catch (e) {
    console.error('[admin_users][ADMIN_STATUS] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_USERS_ADMIN_STATUS_ERROR', { error: e && e.message }));
  }
});

// POST /api/admin/users/:id/admin-role
// Body: { action: 'grant'|'revoke', confirmSelf?: true }
router.post('/:id/admin-role', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params && req.params.id);
    if (!Number.isFinite(id) || id <= 0) return next(badRequest('User id inválido', 'INVALID_USER_ID'));

    const actionRaw = (req.body && (req.body.action ?? req.body.Action)) ?? '';
    const action = String(actionRaw || '').trim().toLowerCase();
    if (action !== 'grant' && action !== 'revoke') {
      return next(badRequest("Ação inválida (use 'grant' ou 'revoke')", 'INVALID_ADMIN_ROLE_ACTION'));
    }

    const user = await db.User.findByPk(id, { attributes: ['Id', 'Nome', 'NomeUsuario', 'Email'] });
    if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));

    // Foot-gun guard: require explicit confirm when self-revoking.
    if (action === 'revoke' && req.user && Number(req.user.Id) === Number(user.Id)) {
      const confirmSelf = !!(req.body && (req.body.confirmSelf === true || req.body.confirmSelf === 1 || req.body.confirmSelf === '1'));
      if (!confirmSelf) {
        return next(badRequest('Confirmação obrigatória para remover seu próprio admin (confirmSelf=true)', 'SELF_ADMIN_REVOKE_CONFIRM_REQUIRED'));
      }
    }

    // Ensure RBAC tables exist before trying to mutate.
    const rbacProbe = await checkAdminRbac(user.Id);
    if (!rbacProbe.rbacAvailable) {
      return next(badRequest(
        'RBAC indisponível neste ambiente. Configure ADMIN_EMAILS (env) ou rode as migrations SQL de RBAC para gerenciar admins via UI.',
        'RBAC_NOT_AVAILABLE'
      ));
    }

    const roleId = await getAdminRoleIdOrCreate();

    if (action === 'grant') {
      await db.sequelize.query(
        'INSERT INTO public.user_role (user_id, role_id) VALUES (:uid, :rid) ON CONFLICT (user_id, role_id) DO NOTHING',
        { replacements: { uid: user.Id, rid: roleId }, type: db.Sequelize.QueryTypes.INSERT }
      );
    } else {
      await db.sequelize.query(
        'DELETE FROM public.user_role WHERE user_id = :uid AND role_id = :rid',
        { replacements: { uid: user.Id, rid: roleId }, type: db.Sequelize.QueryTypes.DELETE }
      );
    }

    const after = await checkAdminRbac(user.Id);
    const isAdminFallback = checkAdminFallback(user);
    const isAdminEffective = (after.rbacAvailable && after.isAdminRbac) || isAdminFallback;

    return res.json({
      ok: true,
      action,
      user: { Id: user.Id, Nome: user.Nome, NomeUsuario: user.NomeUsuario, Email: user.Email },
      rbacAvailable: after.rbacAvailable,
      isAdminRbac: after.isAdminRbac,
      isAdminFallback,
      isAdminEffective,
    });
  } catch (e) {
    console.error('[admin_users][ADMIN_ROLE] error:', e && e.message);
    if (isMissingRelationError(e)) {
      return next(badRequest(
        'RBAC indisponível neste ambiente. Configure ADMIN_EMAILS (env) ou rode as migrations SQL de RBAC para gerenciar admins via UI.',
        'RBAC_NOT_AVAILABLE'
      ));
    }
    return next(internalError('Internal error', 'ADMIN_USERS_ADMIN_ROLE_ERROR', { error: e && e.message }));
  }
});

module.exports = router;