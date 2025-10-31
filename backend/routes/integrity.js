const express = require('express');
const router = express.Router();
const integrity = require('../controllers/integrityController');

router.post('/verify', integrity.verify);

module.exports = router;
