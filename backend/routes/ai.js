const express = require('express');
const router = express.Router();
const requireUserSession = require('../middleware/requireUserSession');
const aiController = require('../controllers/aiController');
const requireAdmin = require('../middleware/requireAdmin');
const aiWeb = require('../controllers/aiWebController');
const aiMasterdata = require('../controllers/aiMasterdataController');

// Dashboard de Insights (baseado em métricas agregadas + (opcional) geração via Ollama)
router.get('/insights', requireUserSession, aiController.getInsightsDashboard);

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
