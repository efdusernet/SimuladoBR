const express = require('express');
const router = express.Router();
const db = require('../models');
const requireAdmin = require('../middleware/requireAdmin');
const { badRequest, internalError } = require('../middleware/errors');

async function ensureUserIsAdmin(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return false;

  const rows = await db.sequelize.query(
    'SELECT 1 FROM public.user_role ur JOIN public.role r ON r.id = ur.role_id WHERE ur.user_id = :uid AND r.slug = :slug AND (r.ativo = TRUE OR r.ativo IS NULL) LIMIT 1',
    { replacements: { uid, slug: 'admin' }, type: db.Sequelize.QueryTypes.SELECT }
  );
  return !!(rows && rows.length);
}

function isMissingTableError(err) {
  const code = (err && err.original && err.original.code) || err.code || '';
  const msg = (err && (err.message || err.toString())) || '';
  return code === '42P01' || /relation .* does not exist/i.test(msg);
}

// GET /api/admin/communication/admins
// List all admin users for selection UI
router.get('/admins', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const offset = parseInt(req.query.offset) || 0;

    const rows = await db.sequelize.query(
      'SELECT u."Id" AS "Id", u."Nome" AS "Nome", u."NomeUsuario" AS "NomeUsuario", u."Email" AS "Email"\n' +
      'FROM public.usuario u\n' +
      'JOIN public.user_role ur ON ur.user_id = u."Id"\n' +
      'JOIN public.role r ON r.id = ur.role_id\n' +
      'WHERE r.slug = :slug AND (r.ativo = TRUE OR r.ativo IS NULL)\n' +
      'ORDER BY COALESCE(u."Nome", \'\') ASC, u."Id" ASC\n' +
      'LIMIT :limit OFFSET :offset',
      { replacements: { slug: 'admin', limit, offset }, type: db.Sequelize.QueryTypes.SELECT }
    );

    return res.json({ count: rows.length, items: rows });
  } catch (e) {
    console.error('[admin_communication][LIST_ADMINS] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_COMMUNICATION_LIST_ADMINS_ERROR', { error: e && e.message }));
  }
});

// GET /api/admin/communication/recipients
router.get('/recipients', requireAdmin, async (req, res, next) => {
  try {
    if (!db.CommunicationRecipient) {
      return next(internalError('Model CommunicationRecipient not available', 'MODEL_COMMUNICATION_RECIPIENT_MISSING'));
    }

    const rows = await db.sequelize.query(
      'SELECT cr.user_id AS "UserId", u."Nome" AS "Nome", u."Email" AS "Email"\n' +
      'FROM public.communication_recipient cr\n' +
      'JOIN public.usuario u ON u."Id" = cr.user_id\n' +
      'WHERE cr.active = TRUE\n' +
      'ORDER BY COALESCE(u."Nome", \'\') ASC, u."Id" ASC',
      { type: db.Sequelize.QueryTypes.SELECT }
    );

    return res.json({ count: rows.length, items: rows });
  } catch (e) {
    if (isMissingTableError(e)) {
      return next(internalError('Tabela communication_recipient não existe. Aplique a migration SQL correspondente.', 'COMMUNICATION_RECIPIENT_TABLE_MISSING'));
    }
    console.error('[admin_communication][LIST] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_COMMUNICATION_LIST_RECIPIENTS_ERROR', { error: e && e.message }));
  }
});

// POST /api/admin/communication/recipients { userId }
router.post('/recipients', requireAdmin, async (req, res, next) => {
  try {
    if (!db.CommunicationRecipient) {
      return next(internalError('Model CommunicationRecipient not available', 'MODEL_COMMUNICATION_RECIPIENT_MISSING'));
    }

    const userId = Number(req.body && req.body.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return next(badRequest('userId inválido', 'INVALID_USER_ID'));
    }

    const isAdmin = await ensureUserIsAdmin(userId);
    if (!isAdmin) return next(badRequest('Usuário não é admin', 'USER_NOT_ADMIN'));

    const existing = await db.CommunicationRecipient.findOne({ where: { UserId: userId } });
    if (existing) {
      if (!existing.Ativo) {
        existing.Ativo = true;
        existing.UpdatedAt = new Date();
        await existing.save();
      }
      return res.json({ ok: true, userId, created: false });
    }

    await db.CommunicationRecipient.create({
      UserId: userId,
      Ativo: true,
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
    });

    return res.json({ ok: true, userId, created: true });
  } catch (e) {
    if (isMissingTableError(e)) {
      return next(internalError('Tabela communication_recipient não existe. Aplique a migration SQL correspondente.', 'COMMUNICATION_RECIPIENT_TABLE_MISSING'));
    }
    console.error('[admin_communication][ADD] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_COMMUNICATION_ADD_RECIPIENT_ERROR', { error: e && e.message }));
  }
});

// DELETE /api/admin/communication/recipients/:userId
router.delete('/recipients/:userId', requireAdmin, async (req, res, next) => {
  try {
    if (!db.CommunicationRecipient) {
      return next(internalError('Model CommunicationRecipient not available', 'MODEL_COMMUNICATION_RECIPIENT_MISSING'));
    }

    const userId = Number(req.params && req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return next(badRequest('userId inválido', 'INVALID_USER_ID'));
    }

    const existing = await db.CommunicationRecipient.findOne({ where: { UserId: userId } });
    if (!existing) return res.json({ ok: true, userId, removed: false });

    existing.Ativo = false;
    existing.UpdatedAt = new Date();
    await existing.save();

    return res.json({ ok: true, userId, removed: true });
  } catch (e) {
    if (isMissingTableError(e)) {
      return next(internalError('Tabela communication_recipient não existe. Aplique a migration SQL correspondente.', 'COMMUNICATION_RECIPIENT_TABLE_MISSING'));
    }
    console.error('[admin_communication][REMOVE] error:', e && e.message);
    return next(internalError('Internal error', 'ADMIN_COMMUNICATION_REMOVE_RECIPIENT_ERROR', { error: e && e.message }));
  }
});

module.exports = router;
