const express = require('express');
const router = express.Router();
const indicatorController = require('../controllers/indicatorController');

router.get('/overview', indicatorController.getOverview);

module.exports = router;
