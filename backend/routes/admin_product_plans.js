const express = require('express');
const router = express.Router();

const requireAdmin = require('../middleware/requireAdmin');
const { badRequest, notFound, internalError } = require('../middleware/errors');
const store = require('../services/productPlansStore');
const { getDefaultPlans } = require('../services/defaultProductPlans');

function getDefaultPlansFromProductSite() {
  return getDefaultPlans();
}

function sortPlans(plans) {
  return [...plans].sort((a, b) => {
    const ao = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 1000;
    const bo = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 1000;
    if (ao !== bo) return ao - bo;
    const an = String(a.name || '');
    const bn = String(b.name || '');
    return an.localeCompare(bn, 'pt-BR');
  });
}

// All endpoints require admin.
router.use(requireAdmin);

// GET /api/admin/product-plans
router.get('/', async (req, res, next) => {
  try {
    const fallbackPlans = getDefaultPlansFromProductSite();
    const result = await store.loadPlans({ fallbackPlans });
    const items = sortPlans(result.plans || []);
    return res.json({ source: result.source, ok: result.ok !== false, count: items.length, items, error: result.error || null });
  } catch (e) {
    return next(internalError('Internal error', 'ADMIN_PRODUCT_PLANS_LIST_ERROR', { error: e && e.message }));
  }
});

// POST /api/admin/product-plans/seed-defaults
// Writes the current default plans to the JSON file.
// Use ?force=1 to overwrite an existing file.
router.post('/seed-defaults', async (req, res, next) => {
  try {
    const force = String(req.query && req.query.force ? req.query.force : '') === '1';
    const fallbackPlans = getDefaultPlansFromProductSite();
    const current = await store.loadPlans({ fallbackPlans });

    if (!force && current.source === 'file') {
      return next(badRequest('Arquivo já existe. Use force=1 para sobrescrever.', 'PLANS_FILE_ALREADY_EXISTS'));
    }

    const normalized = store.normalizePlansArray(fallbackPlans);
    await store.savePlans(normalized);
    return res.json({ ok: true, written: true, count: normalized.length, filePath: store.FILE_PATH });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return next(internalError('Internal error', 'ADMIN_PRODUCT_PLANS_SEED_ERROR', { error: msg }));
  }
});

// POST /api/admin/product-plans
router.post('/', async (req, res, next) => {
  try {
    const plan = req.body || {};
    const normalized = store.normalizePlan(plan);

    const fallbackPlans = getDefaultPlansFromProductSite();
    const current = await store.loadPlans({ fallbackPlans });
    const plans = Array.isArray(current.plans) ? [...current.plans] : [];

    if (plans.some((p) => p.id === normalized.id)) {
      return next(badRequest('id já existe', 'PLAN_ID_ALREADY_EXISTS'));
    }

    plans.push(normalized);
    await store.savePlans(plans);

    return res.status(201).json({ ok: true, item: normalized });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (/required|match|must/i.test(msg)) return next(badRequest(msg, 'INVALID_PLAN'));
    return next(internalError('Internal error', 'ADMIN_PRODUCT_PLANS_CREATE_ERROR', { error: msg }));
  }
});

// PUT /api/admin/product-plans/:id
router.put('/:id', async (req, res, next) => {
  try {
    const id = String(req.params && req.params.id ? req.params.id : '').trim();
    if (!id) return next(badRequest('id obrigatório', 'PLAN_ID_REQUIRED'));

    const plan = req.body || {};
    // Enforce id from URL (avoid id swap attacks)
    plan.id = id;

    const normalized = store.normalizePlan(plan);

    const fallbackPlans = getDefaultPlansFromProductSite();
    const current = await store.loadPlans({ fallbackPlans });
    const plans = Array.isArray(current.plans) ? [...current.plans] : [];
    const idx = plans.findIndex((p) => p.id === id);
    if (idx < 0) return next(notFound('Plano não encontrado', 'PLAN_NOT_FOUND'));

    plans[idx] = { ...plans[idx], ...normalized, id };
    await store.savePlans(plans);

    return res.json({ ok: true, item: plans[idx] });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (/required|match|must/i.test(msg)) return next(badRequest(msg, 'INVALID_PLAN'));
    return next(internalError('Internal error', 'ADMIN_PRODUCT_PLANS_UPDATE_ERROR', { error: msg }));
  }
});

// DELETE /api/admin/product-plans/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const id = String(req.params && req.params.id ? req.params.id : '').trim();
    if (!id) return next(badRequest('id obrigatório', 'PLAN_ID_REQUIRED'));

    const fallbackPlans = getDefaultPlansFromProductSite();
    const current = await store.loadPlans({ fallbackPlans });
    const plans = Array.isArray(current.plans) ? [...current.plans] : [];
    const before = plans.length;
    const after = plans.filter((p) => p && p.id !== id);
    if (after.length === before) return next(notFound('Plano não encontrado', 'PLAN_NOT_FOUND'));
    await store.savePlans(after);
    return res.json({ ok: true, deleted: true });
  } catch (e) {
    return next(internalError('Internal error', 'ADMIN_PRODUCT_PLANS_DELETE_ERROR', { error: e && e.message }));
  }
});

module.exports = router;
