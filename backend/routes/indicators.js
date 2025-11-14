const express = require('express');
const router = express.Router();
const indicatorController = require('../controllers/indicatorController');
const auth = require('../middleware/auth');

// All indicators endpoints require JWT via Authorization: Bearer <token>
router.get('/overview', auth, indicatorController.getOverview);
router.get('/exams-completed', auth, indicatorController.getExamsCompleted);
router.get('/approval-rate', auth, indicatorController.getApprovalRate);

module.exports = router;
