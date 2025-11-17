const express = require('express');
const router = express.Router();
const meta = require('../controllers/metaController');

router.get('/areas', meta.listAreasConhecimento);
router.get('/grupos', meta.listGruposProcesso);
router.get('/dominios', meta.listDominios);
router.get('/dominios-geral', meta.listDominiosGeral);
router.get('/principios', meta.listPrincipios);
router.get('/categorias', meta.listCategorias);
router.get('/config', meta.getConfig);

module.exports = router;
