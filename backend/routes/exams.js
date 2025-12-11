const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const { examSchemas, validate } = require('../middleware/validation');

router.get('/', examController.listExams);
// Types registry for UI
router.get('/types', examController.listExamTypes);
router.post('/:id/start', validate(examSchemas.startExam, 'params'), examController.startExam);
// Select questions for an exam session (temporary, returns sessionId and questions)
router.post('/select', validate(examSchemas.selectQuestions), examController.selectQuestions);
// Start on-demand session (server stores question order; client fetches one by one)
router.post('/start-on-demand', validate(examSchemas.startOnDemand), examController.startOnDemand);
// Fetch one question by index for a session
router.get('/:sessionId/question/:index', examController.getQuestion);
// Pause management with server-side validation
router.post('/:sessionId/pause/start', validate(examSchemas.pauseSession, 'params'), examController.pauseStart);
router.post('/:sessionId/pause/skip', validate(examSchemas.pauseSession, 'params'), examController.pauseSkip);
router.get('/:sessionId/pause/status', examController.pauseStatus);
// Submit answers for grading
router.post('/submit', validate(examSchemas.submitAnswers), examController.submitAnswers);
// Rebuild a session in memory from DB after a restart
router.post('/resume', validate(examSchemas.resumeSession), examController.resumeSession);
// Stats: last finished attempt summary for gauge
router.get('/last', examController.lastAttemptSummary);
// Stats: last N finished attempts (default 3) for styling rules on gauge
router.get('/history', examController.lastAttemptsHistory);
// Exam result for review pages
router.get('/result/:attemptId', validate(examSchemas.getAttemptResult, 'params'), examController.getAttemptResult);
module.exports = router;
