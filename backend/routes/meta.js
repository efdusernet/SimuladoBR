const express = require('express');
const router = express.Router();
const meta = require('../controllers/metaController');

router.get('/areas', meta.listAreasConhecimento);
router.get('/grupos', meta.listGruposProcesso);
router.get('/dominios', meta.listDominios);

module.exports = router;
