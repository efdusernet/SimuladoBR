const express = require('express');
const router = express.Router();
const indicatorController = require('../controllers/indicatorController');
const auth = require('../middleware/auth');
const requireUserSession = require('../middleware/requireUserSession');
const userParamsStore = require('../services/userParamsStore');
const { forbidden } = require('../middleware/errors');

function requireIndicatorsTab(tabKey) {
	return async (req, res, next) => {
		try {
			const user = req.userModel;
			const isBlocked = Boolean(user && user.BloqueioAtivado);
			if (!isBlocked) return next();

			const params = await userParamsStore.getCachedParams({ maxAgeMs: 10_000 });
			const premiumTabs = (params && params.premiumOnly && Array.isArray(params.premiumOnly.indicatorsTabs))
				? params.premiumOnly.indicatorsTabs
				: [];

			const isPremiumOnlyTab = premiumTabs.includes(String(tabKey));
			if (!isPremiumOnlyTab) return next();

			return next(forbidden('Premium required', 'PREMIUM_REQUIRED'));
		} catch (e) {
			return next(e);
		}
	};
}

// All indicators endpoints require JWT via Authorization: Bearer <token>
router.get('/overview', auth, requireIndicatorsTab('dist'), indicatorController.getOverview);
router.get('/overview-detailed', auth, requireIndicatorsTab('dist'), indicatorController.getOverviewDetailed);
router.get('/exams-completed', auth, requireIndicatorsTab('dist'), indicatorController.getExamsCompleted);
router.get('/approval-rate', auth, requireIndicatorsTab('dist'), indicatorController.getApprovalRate);
router.get('/failure-rate', auth, requireIndicatorsTab('dist'), indicatorController.getFailureRate);
router.get('/questions-count', auth, requireIndicatorsTab('dist'), indicatorController.getQuestionsCount);
router.get('/answered-count', auth, requireIndicatorsTab('dist'), indicatorController.getAnsweredQuestionsCount);
router.get('/total-hours', auth, requireIndicatorsTab('dist'), indicatorController.getTotalHours);
router.get('/process-group-stats', auth, requireIndicatorsTab('dist'), indicatorController.getProcessGroupStats);
router.get('/area-knowledge-stats', auth, requireIndicatorsTab('dist'), indicatorController.getAreaConhecimentoStats);
router.get('/approach-stats', auth, requireIndicatorsTab('dist'), indicatorController.getAbordagemStats);

router.get('/details-last', auth, requireIndicatorsTab('detalhes'), indicatorController.getDetailsLast);
router.get('/details-prev', auth, requireIndicatorsTab('detalhes'), indicatorController.getDetailsPrevious);
router.get('/dominiogeral-details-last2', auth, requireIndicatorsTab('detalhes'), indicatorController.getDominioGeralDetailsLastTwo);

router.get('/IND10', requireUserSession, requireIndicatorsTab('dominios'), indicatorController.getPerformancePorDominio);
// IND11: Tempo médio por questão
router.get('/IND11', auth, requireIndicatorsTab('dashboard'), indicatorController.getAvgTimePerQuestion);
router.get('/avg-time-per-question', auth, requireIndicatorsTab('dashboard'), indicatorController.getAvgTimePerQuestion);
// IND12: Média ponderada por domínio (agregado)
router.get('/IND12', requireUserSession, requireIndicatorsTab('dominios'), indicatorController.getPerformancePorDominioAgregado);
// Probabilidade de aprovação (derivada do IND12): endpoint dedicado para permitir gating independente da aba "dominios"
router.get('/probability', requireUserSession, requireIndicatorsTab('prob'), indicatorController.getPerformancePorDominioAgregado);
router.get('/attempts-history-extended', auth, requireIndicatorsTab('dashboard'), indicatorController.getAttemptsHistoryExtended);

module.exports = router;
