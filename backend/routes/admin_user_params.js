const express = require('express');
const router = express.Router();

const requireAdmin = require('../middleware/requireAdmin');
const { badRequest, internalError } = require('../middleware/errors');
const store = require('../services/userParamsStore');

// All endpoints require admin.
router.use(requireAdmin);

// GET /api/admin/user-params
router.get('/', async (req, res, next) => {
  try {
    const result = await store.loadParams();
    return res.json({ source: result.source, ok: result.ok !== false, params: result.params, error: result.error || null });
  } catch (e) {
    return next(internalError('Internal error', 'ADMIN_USER_PARAMS_LIST_ERROR', { error: e && e.message }));
  }
});

// POST /api/admin/user-params/seed-defaults
// Writes the default params to the JSON file.
// Use ?force=1 to overwrite an existing file.
router.post('/seed-defaults', async (req, res, next) => {
  try {
    const force = String(req.query && req.query.force ? req.query.force : '') === '1';

    const current = await store.loadParams();
    if (!force && current.source === 'file') {
      return next(badRequest('Arquivo já existe. Use force=1 para sobrescrever.', 'USER_PARAMS_FILE_ALREADY_EXISTS'));
    }

    const defaults = store.getDefaultParams();
    const saved = await store.saveParams(defaults);
    store.clearCache();
    return res.json({ ok: true, written: true, filePath: saved.filePath, params: saved.params });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return next(internalError('Internal error', 'ADMIN_USER_PARAMS_SEED_ERROR', { error: msg }));
  }
});

// PUT /api/admin/user-params
// Overwrites the whole params object.
router.put('/', async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return next(badRequest('Body inválido', 'INVALID_BODY'));
    }
    const saved = await store.saveParams(body);
    store.clearCache();
    return res.json({ ok: true, params: saved.params });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return next(internalError('Internal error', 'ADMIN_USER_PARAMS_SAVE_ERROR', { error: msg }));
  }
});

module.exports = router;
