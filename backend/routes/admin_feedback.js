const express = require('express');
const router = express.Router();
const db = require('../models');
const requireAdmin = require('../middleware/requireAdmin');
const { unauthorized, badRequest, notFound, internalError } = require('../middleware/errors');

// GET /api/admin/feedback/pending
// Lists Feedback entries without any RetornoFeedback
router.get('/pending', requireAdmin, async (req, res, next) => {
  try {
    // Find feedbacks with zero respostas
    const [rows] = await db.sequelize.query(`
      SELECT f.id, f.texto, f.idcategoria, f.idquestao,
             f.reportadopor AS "usuarioId",
             u."Nome" AS "usuarioNome"
      FROM "Feedback" f
      LEFT JOIN "RetornoFeedback" r ON r.idfeedback = f.id
      LEFT JOIN "Usuario" u ON u."Id" = f.reportadopor
      WHERE r.id IS NULL
      ORDER BY f.id DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error('admin.feedback.pending error', e);
    return next(internalError('Erro ao listar feedbacks pendentes', 'ADMIN_FEEDBACK_PENDING_ERROR', { error: e && e.message }));
  }
});

// POST /api/admin/feedback/respond
// Body: { idfeedback, resposta }
router.post('/respond', requireAdmin, async (req, res, next) => {
  try {
    const { idfeedback, resposta } = req.body || {};
    const fid = Number(idfeedback);
    if (!Number.isInteger(fid) || fid <= 0) return next(badRequest('idfeedback inválido', 'INVALID_IDFEEDBACK'));
    if (!resposta || typeof resposta !== 'string' || !resposta.trim()) return next(badRequest('resposta obrigatória', 'RESPOSTA_REQUIRED'));

    const fb = await db.Feedback.findByPk(fid);
    if (!fb) return next(notFound('Feedback não encontrado', 'FEEDBACK_NOT_FOUND'));

    // Determine admin responder user id; requireAdmin places req.admin or req.user
    const adminId = (req.user && (req.user.Id || req.user.id)) || null;
    if (!adminId) return next(unauthorized('Usuário administrador não identificado', 'ADMIN_IDENTITY_MISSING'));

    const created = await db.RetornoFeedback.create({
      idquestao: fb.idquestao,
      resposta: resposta.trim(),
      idusuariorespondeu: Number(adminId),
      idfeedback: fb.id,
    });
    res.status(201).json({ id: created.id });
  } catch (e) {
    console.error('admin.feedback.respond error', e);
    return next(internalError('Erro ao registrar resposta', 'ADMIN_FEEDBACK_RESPOND_ERROR', { error: e && e.message }));
  }
});

module.exports = router;
