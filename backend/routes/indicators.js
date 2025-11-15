const express = require('express');
const router = express.Router();
const indicatorController = require('../controllers/indicatorController');
const auth = require('../middleware/auth');

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

module.exports = router;
