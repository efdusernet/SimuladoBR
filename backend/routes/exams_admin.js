const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/requireAdmin');
const examController = require('../controllers/examController');

// Admin-only endpoints for lifecycle management
router.post('/mark-abandoned', requireAdmin, examController.markAbandonedAttempts);
router.post('/purge-abandoned', requireAdmin, examController.purgeAbandonedAttempts);

module.exports = router;
