const express = require('express');
const router = express.Router();
const meta = require('../controllers/metaController');

router.get('/areas', meta.listAreasConhecimento);
router.get('/grupos', meta.listGruposProcesso);
router.get('/dominios', meta.listDominios);
// Alias for dominio_desempenho (keeps backward compatibility with /dominios)
router.get('/ddesempenho', meta.listDominios);
router.get('/dominios-geral', meta.listDominiosGeral);
router.get('/principios', meta.listPrincipios);
router.get('/categorias', meta.listCategorias);
// Alias for abordagem (keeps backward compatibility with /categorias)
router.get('/abordagens', meta.listAbordagens);
router.get('/niveis-dificuldade', meta.listNiveisDificuldade);
router.get('/tasks', meta.listTasks);
router.get('/versoes-exame', meta.listVersoesExame);
router.get('/config', meta.getConfig);

module.exports = router;
