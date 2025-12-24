const express = require('express');
const router = express.Router();
const requireUserSession = require('../middleware/requireUserSession');
const aiController = require('../controllers/aiController');

// Dashboard de Insights (baseado em métricas agregadas + (opcional) geração via Ollama)
router.get('/insights', requireUserSession, aiController.getInsightsDashboard);

module.exports = router;
