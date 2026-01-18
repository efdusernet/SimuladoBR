const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/requireAdmin');
const { badRequest, forbidden, internalError } = require('../middleware/errors');
const { cleanupNonMasterdata } = require('../scripts/cleanupNonMasterdata');

function isCleanupEnabled() {
  // Extremely dangerous operation; keep it opt-in.
  if (process.env.ADMIN_DB_CLEANUP_ENABLED === 'true') return true;
  // Allow in dev/test by default.
  const env = String(process.env.NODE_ENV || '').toLowerCase();
  return env === 'development' || env === 'test';
}

// POST /api/admin/db/cleanup/non-masterdata
// Body:
//  {
//    dryRun: true|false,
//    confirm: 'LIMPAR_NAO_MASTERDATA' (required when dryRun=false),
//    options: { keepUsers, keepRbac, keepEntitlements, keepNotifications, keepCommunication }
//  }
router.post('/cleanup/non-masterdata', requireAdmin, async (req, res, next) => {
  try {
    if (!isCleanupEnabled()) {
      return next(forbidden('Operação desabilitada. Defina ADMIN_DB_CLEANUP_ENABLED=true (ou use NODE_ENV=development).', 'ADMIN_DB_CLEANUP_DISABLED'));
    }

    const body = (req && req.body) ? req.body : {};
    const dryRun = body.dryRun !== false;
    const confirm = body.confirm != null ? String(body.confirm) : null;

    const opt = (body && typeof body.options === 'object' && body.options) ? body.options : {};

    const result = await cleanupNonMasterdata({
      dryRun,
      confirm,
      keepUsers: opt.keepUsers !== false,
      keepRbac: opt.keepRbac !== false,
      keepEntitlements: opt.keepEntitlements !== false,
      keepNotifications: opt.keepNotifications === true,
      keepCommunication: opt.keepCommunication !== false,
      masterdataExtra: Array.isArray(opt.masterdataExtra) ? opt.masterdataExtra : [],
    });

    return res.json({ ok: true, ...result });
  } catch (e) {
    if (e && e.code === 'CONFIRMATION_REQUIRED') {
      return next(badRequest(e.message, 'CONFIRMATION_REQUIRED'));
    }
    return next(internalError('Erro interno', 'ADMIN_DB_CLEANUP_ERROR', { error: e && e.message }));
  }
});

module.exports = router;
