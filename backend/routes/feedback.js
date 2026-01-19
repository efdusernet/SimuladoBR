const express = require('express');
const { logger } = require('../utils/logger');
const router = express.Router();
const db = require('../models');
const requireUserSession = require('../middleware/requireUserSession');
const { badRequest, notFound, internalError } = require('../middleware/errors');

// GET /api/feedback/categories -> lista categorias { id, descricao }
router.get('/categories', requireUserSession, async (req, res, next) => {
	try {
		const list = await db.CategoriaFeedback.findAll({ attributes: ['id', 'descricao'], order: [['descricao','ASC']] });
		res.json(list);
	} catch (e) {
		logger.error('feedback.categories error', e);
		return next(internalError('Erro ao listar categorias', 'FEEDBACK_LIST_CATEGORIES_ERROR', { error: e && e.message }));
	}
});

// POST /api/feedback -> cria feedback { texto, idcategoria, idquestao, userId }
router.post('/', requireUserSession, async (req, res, next) => {
	try {
		const { texto, idcategoria, idquestao, userId } = req.body || {};
		if (!texto || typeof texto !== 'string' || !texto.trim()) {
			return next(badRequest('Texto obrigatório', 'TEXTO_REQUIRED'));
		}
		const catId = Number(idcategoria);
		if (!Number.isInteger(catId) || catId <= 0) {
			return next(badRequest('idcategoria inválido', 'INVALID_IDCATEGORIA'));
		}
		// Verifica se categoria existe
		const cat = await db.CategoriaFeedback.findByPk(catId);
		if (!cat) return next(notFound('Categoria não encontrada', 'CATEGORIA_NOT_FOUND'));

		const qId = Number(idquestao);
		if (!Number.isInteger(qId) || qId <= 0) {
			return next(badRequest('idquestao inválido', 'INVALID_IDQUESTAO'));
		}
		const reportedBy = Number(userId);
		const payload = { texto: texto.trim(), idcategoria: catId, idquestao: qId };
		if (Number.isInteger(reportedBy) && reportedBy > 0) payload.reportadopor = reportedBy;
		const created = await db.Feedback.create(payload);
		res.status(201).json({ id: created.id, idcategoria: created.idcategoria, idquestao: created.idquestao, reportadopor: created.reportadopor ?? null });
	} catch (e) {
		logger.error('feedback.create error', e);
		return next(internalError('Erro ao criar feedback', 'FEEDBACK_CREATE_ERROR', { error: e && e.message }));
	}
});

module.exports = router;
