const express = require('express');
const router = express.Router();
const indicatorController = require('../controllers/indicatorController');
const auth = require('../middleware/auth');
const requireUserSession = require('../middleware/requireUserSession');

// All indicators endpoints require JWT via Authorization: Bearer <token>
router.get('/overview', auth, indicatorController.getOverview);
router.get('/overview-detailed', auth, indicatorController.getOverviewDetailed);
router.get('/exams-completed', auth, indicatorController.getExamsCompleted);
router.get('/approval-rate', auth, indicatorController.getApprovalRate);
router.get('/failure-rate', auth, indicatorController.getFailureRate);
router.get('/questions-count', auth, indicatorController.getQuestionsCount);
router.get('/answered-count', auth, indicatorController.getAnsweredQuestionsCount);
router.get('/total-hours', auth, indicatorController.getTotalHours);
router.get('/process-group-stats', auth, indicatorController.getProcessGroupStats);
router.get('/area-knowledge-stats', auth, indicatorController.getAreaConhecimentoStats);
router.get('/approach-stats', auth, indicatorController.getAbordagemStats);
router.get('/details-last', auth, indicatorController.getDetailsLast);
router.get('/details-prev', auth, indicatorController.getDetailsPrevious);
router.get('/dominiogeral-details-last2', auth, indicatorController.getDominioGeralDetailsLastTwo);
router.get('/IND10', requireUserSession, indicatorController.getPerformancePorDominio);
// IND11: Tempo médio por questão
router.get('/IND11', auth, indicatorController.getAvgTimePerQuestion);
router.get('/avg-time-per-question', auth, indicatorController.getAvgTimePerQuestion);
// IND12: Média ponderada por domínio (agregado)
router.get('/IND12', requireUserSession, indicatorController.getPerformancePorDominioAgregado);
router.get('/attempts-history-extended', auth, indicatorController.getAttemptsHistoryExtended);

module.exports = router;
