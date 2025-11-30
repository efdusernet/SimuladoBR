const express = require('express');
const router = express.Router();
const db = require('../models');
const requireUserSession = require('../middleware/requireUserSession');

// GET /api/feedback/categories -> lista categorias { id, descricao }
router.get('/categories', requireUserSession, async (req, res) => {
	try {
		const list = await db.CategoriaFeedback.findAll({ attributes: ['id', 'descricao'], order: [['descricao','ASC']] });
		res.json(list);
	} catch (e) {
		console.error('feedback.categories error', e);
		res.status(500).json({ error: 'Erro ao listar categorias' });
	}
});

// POST /api/feedback -> cria feedback { texto, idcategoria, idquestao }
router.post('/', requireUserSession, async (req, res) => {
	try {
		const { texto, idcategoria, idquestao } = req.body || {};
		if (!texto || typeof texto !== 'string' || !texto.trim()) {
			return res.status(400).json({ error: 'Texto obrigatório' });
		}
		const catId = Number(idcategoria);
		if (!Number.isInteger(catId) || catId <= 0) {
			return res.status(400).json({ error: 'idcategoria inválido' });
		}
		// Verifica se categoria existe
		const cat = await db.CategoriaFeedback.findByPk(catId);
		if (!cat) return res.status(404).json({ error: 'Categoria não encontrada' });

		const qId = Number(idquestao);
		if (!Number.isInteger(qId) || qId <= 0) {
			return res.status(400).json({ error: 'idquestao inválido' });
		}
		const created = await db.Feedback.create({ texto: texto.trim(), idcategoria: catId, idquestao: qId });
		res.status(201).json({ id: created.id, idcategoria: created.idcategoria, idquestao: created.idquestao });
	} catch (e) {
		console.error('feedback.create error', e);
		res.status(500).json({ error: 'Erro ao criar feedback' });
	}
});

module.exports = router;
