const express = require('express');
const router = express.Router();

const requireAdmin = require('../middleware/requireAdmin');
const adminDicasController = require('../controllers/adminDicasController');

// GET /api/admin/dicas?versionId=2&q=texto
router.get('/', requireAdmin, adminDicasController.listDicas);

// GET /api/admin/dicas/versions
router.get('/versions', requireAdmin, adminDicasController.listVersions);

// POST /api/admin/dicas
router.post('/', requireAdmin, adminDicasController.createDica);

// PUT /api/admin/dicas/:id
router.put('/:id', requireAdmin, adminDicasController.updateDica);

// DELETE /api/admin/dicas/:id
router.delete('/:id', requireAdmin, adminDicasController.deleteDica);

module.exports = router;
