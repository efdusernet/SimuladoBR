const express = require('express');
const router = express.Router();
const requireUserSession = require('../middleware/requireUserSession');
const aiController = require('../controllers/aiController');

// Dashboard de Insights (baseado em métricas agregadas + (opcional) geração via Ollama)
router.get('/insights', requireUserSession, aiController.getInsightsDashboard);

// Sugestão de literaturas baseada na versão efetiva do ECO do usuário
router.get('/literature-suggestions', requireUserSession, aiController.getLiteratureSuggestions);

module.exports = router;
