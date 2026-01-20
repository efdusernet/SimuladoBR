const express = require('express');
const router = express.Router();

const requireUserSession = require('../middleware/requireUserSession');
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
router.get('/insights', requireUserSession, flashcardInsightsController.getInsights);

// Feedback (thumbs up/down)
// POST /api/flashcards/feedback/batch { flashcardIds: number[] }
router.post('/feedback/batch', requireUserSession, flashcardFeedbackController.batchFlashcardFeedback);

// GET /api/flashcards/:flashcardId/feedback
router.get('/:flashcardId/feedback', requireUserSession, flashcardFeedbackController.getFlashcardFeedback);

// POST /api/flashcards/:flashcardId/feedback { vote: 1 | -1 | 0 }
router.post('/:flashcardId/feedback', requireUserSession, flashcardFeedbackController.upsertFlashcardFeedback);

module.exports = router;
