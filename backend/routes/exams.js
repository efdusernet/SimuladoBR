const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');

router.get('/', examController.listExams);
router.post('/:id/start', examController.startExam);
// Select questions for an exam session (temporary, returns sessionId and questions)
router.post('/select', examController.selectQuestions);
// Start on-demand session (server stores question order; client fetches one by one)
router.post('/start-on-demand', examController.startOnDemand);
// Fetch one question by index for a session
router.get('/:sessionId/question/:index', examController.getQuestion);
// Pause management with server-side validation
router.post('/:sessionId/pause/start', examController.pauseStart);
router.post('/:sessionId/pause/skip', examController.pauseSkip);
router.get('/:sessionId/pause/status', examController.pauseStatus);
// Submit answers for grading
router.post('/submit', examController.submitAnswers);
module.exports = router;
