const express = require('express');
const router = express.Router();
const db = require('../models');
const requireAdmin = require('../middleware/requireAdmin');

// GET /api/admin/feedback/pending
// Lists Feedback entries without any RetornoFeedback
router.get('/pending', requireAdmin, async (req, res) => {
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
    res.status(500).json({ error: 'Erro ao listar feedbacks pendentes' });
  }
});

// POST /api/admin/feedback/respond
// Body: { idfeedback, resposta }
router.post('/respond', requireAdmin, async (req, res) => {
  try {
    const { idfeedback, resposta } = req.body || {};
    const fid = Number(idfeedback);
    if (!Number.isInteger(fid) || fid <= 0) return res.status(400).json({ error: 'idfeedback inválido' });
    if (!resposta || typeof resposta !== 'string' || !resposta.trim()) return res.status(400).json({ error: 'resposta obrigatória' });

    const fb = await db.Feedback.findByPk(fid);
    if (!fb) return res.status(404).json({ error: 'Feedback não encontrado' });

    // Determine admin responder user id; requireAdmin places req.admin or req.user
    const adminId = (req.user && (req.user.Id || req.user.id)) || null;
    if (!adminId) return res.status(401).json({ error: 'Usuário administrador não identificado' });

    const created = await db.RetornoFeedback.create({
      idquestao: fb.idquestao,
      resposta: resposta.trim(),
      idusuariorespondeu: Number(adminId),
      idfeedback: fb.id,
    });
    res.status(201).json({ id: created.id });
  } catch (e) {
    console.error('admin.feedback.respond error', e);
    res.status(500).json({ error: 'Erro ao registrar resposta' });
  }
});

module.exports = router;
