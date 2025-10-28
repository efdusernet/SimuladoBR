const express = require('express');
const router = express.Router();
const metaController = require('../controllers/metaController');

// GET /api/meta/areas
router.get('/areas', metaController.listAreas);
// GET /api/meta/grupos
router.get('/grupos', metaController.listGrupos);
// GET /api/meta/dominios
router.get('/dominios', metaController.listDominios);

module.exports = router;
