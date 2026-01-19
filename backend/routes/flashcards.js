const express = require('express');
const router = express.Router();

const requireUserSession = require('../middleware/requireUserSession');
const flashcardController = require('../controllers/flashcardController');
const flashcardScoreController = require('../controllers/flashcardScoreController');
const flashcardAttemptController = require('../controllers/flashcardAttemptController');

// GET /api/flashcards?versionId=2
router.get('/', requireUserSession, flashcardController.listFlashcards);

// POST /api/flashcards/attempts -> create a new flashcard game attempt
router.post('/attempts', requireUserSession, flashcardAttemptController.createAttempt);

// POST /api/flashcards/attempts/:attemptId/answer { flashcardId, correct }
router.post('/attempts/:attemptId/answer', requireUserSession, flashcardAttemptController.upsertAnswer);

// POST /api/flashcards/score { flashcardId, correct }
router.post('/score', requireUserSession, flashcardScoreController.recordScore);

module.exports = router;
