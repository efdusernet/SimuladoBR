const express = require('express');
const router = express.Router();

const requireAdmin = require('../middleware/requireAdmin');
const controller = require('../controllers/adminDataExplorerController');

// GET /api/admin/data-explorer/tables
router.get('/tables', requireAdmin, controller.listTables);

// GET /api/admin/data-explorer/tables/:table/columns
router.get('/tables/:table/columns', requireAdmin, controller.listColumns);

// POST /api/admin/data-explorer/query
router.post('/query', requireAdmin, controller.query);

// POST /api/admin/data-explorer/preview
router.post('/preview', requireAdmin, controller.preview);

module.exports = router;
