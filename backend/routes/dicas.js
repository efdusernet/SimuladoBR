const express = require('express');
const requireUserSession = require('../middleware/requireUserSession');
const { getDicaDoDia } = require('../controllers/dicasController');

const router = express.Router();

// Returns a random tip from public.dicas.
router.get('/today', requireUserSession, getDicaDoDia);

module.exports = router;
