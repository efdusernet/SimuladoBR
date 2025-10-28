const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');

router.get('/', examController.listExams);
router.post('/:id/start', examController.startExam);
// Select questions for an exam session (temporary, returns sessionId and questions)
router.post('/select', examController.selectQuestions);
// Submit answers for grading
router.post('/submit', examController.submitAnswers);
module.exports = router;
