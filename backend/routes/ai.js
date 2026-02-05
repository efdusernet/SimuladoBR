const express = require('express');
const router = express.Router();
const requireUserSession = require('../middleware/requireUserSession');
const aiController = require('../controllers/aiController');
const requireAdmin = require('../middleware/requireAdmin');
const aiWeb = require('../controllers/aiWebController');
const aiMasterdata = require('../controllers/aiMasterdataController');
const userParamsStore = require('../services/userParamsStore');
const { forbidden } = require('../middleware/errors');

async function requireInsightsAccess(req, res, next) {
	try {
		const user = req.userModel || null;
		const isBlocked = Boolean(user && user.BloqueioAtivado);
		if (!isBlocked) return next();

		const params = await userParamsStore.getCachedParams({ maxAgeMs: 10_000 });
		const premiumOnly = !(params && params.premiumOnly && params.premiumOnly.insightsIA === false);
		if (premiumOnly) return next(forbidden('Premium required', 'PREMIUM_REQUIRED'));
		return next();
	} catch (e) {
		return next(e);
	}
}

// Dashboard de Insights (baseado em métricas agregadas + (opcional) geração via Ollama)
router.get('/insights/gemini-usage', requireUserSession, requireInsightsAccess, aiController.getGeminiFlashUsage);
router.get('/insights', requireUserSession, requireInsightsAccess, aiController.getInsightsDashboard);

// Web tools (somente admin): busca e fetch para montar contexto do modelo
router.get('/web/search', requireAdmin, aiWeb.searchWeb);
router.post('/web/fetch', requireAdmin, aiWeb.fetchWeb);

// Auditoria de questão com contexto web (somente admin)
router.post('/question-audit', requireAdmin, aiWeb.auditQuestion);

// Masterdata (somente admin): dicionários dinâmicos para orientar a IA
router.get('/masterdata/question-classification', requireAdmin, aiMasterdata.getQuestionClassification);

// Classificação de questão (somente admin): sugere campos usando masterdata do banco
router.post('/question-classify', requireAdmin, aiWeb.classifyQuestion);

module.exports = router;
