const express = require('express');
const router = express.Router();

const requireUserSession = require('../middleware/requireUserSession');
const userParamsStore = require('../services/userParamsStore');
const { forbidden } = require('../middleware/errors');

async function requireFlashcardsInsightsAccess(req, res, next) {
	try {
		const user = req.userModel || null;
		const isBlocked = Boolean(user && user.BloqueioAtivado);
		if (!isBlocked) return next();

		const params = await userParamsStore.getCachedParams({ maxAgeMs: 10_000 });
		const premiumTabs = (params && params.premiumOnly && Array.isArray(params.premiumOnly.indicatorsTabs))
			? params.premiumOnly.indicatorsTabs
			: [];
		const set = new Set(premiumTabs.map(t => String(t || '').trim().toLowerCase()).filter(Boolean));
		if (set.has('flashcards')) return next(forbidden('Premium required', 'PREMIUM_REQUIRED'));
		return next();
	} catch (e) {
		return next(e);
	}
}

const flashcardController = require('../controllers/flashcardController');
const flashcardScoreController = require('../controllers/flashcardScoreController');
const flashcardAttemptController = require('../controllers/flashcardAttemptController');
const flashcardInsightsController = require('../controllers/flashcardInsightsController');
const flashcardFeedbackController = require('../controllers/flashcardFeedbackController');

// GET /api/flashcards?versionId=2
router.get('/', requireUserSession, flashcardController.listFlashcards);

// POST /api/flashcards/attempts -> create a new flashcard game attempt
router.post('/attempts', requireUserSession, flashcardAttemptController.createAttempt);

// POST /api/flashcards/attempts/:attemptId/answer { flashcardId, correct }
router.post('/attempts/:attemptId/answer', requireUserSession, flashcardAttemptController.upsertAnswer);

// POST /api/flashcards/score { flashcardId, correct }
router.post('/score', requireUserSession, flashcardScoreController.recordScore);

// GET /api/flashcards/insights?min_total=5&top_n=10
router.get('/insights', requireUserSession, requireFlashcardsInsightsAccess, flashcardInsightsController.getInsights);

// Feedback (thumbs up/down)
// POST /api/flashcards/feedback/batch { flashcardIds: number[] }
router.post('/feedback/batch', requireUserSession, flashcardFeedbackController.batchFlashcardFeedback);

// GET /api/flashcards/:flashcardId/feedback
router.get('/:flashcardId/feedback', requireUserSession, flashcardFeedbackController.getFlashcardFeedback);

// POST /api/flashcards/:flashcardId/feedback { vote: 1 | -1 | 0 }
router.post('/:flashcardId/feedback', requireUserSession, flashcardFeedbackController.upsertFlashcardFeedback);

module.exports = router;
