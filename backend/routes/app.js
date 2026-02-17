const express = require('express');

const requireUserSession = require('../middleware/requireUserSession');
const { internalError } = require('../middleware/errors');
const marketplaceAccess = require('../services/marketplaceAccessService');

const router = express.Router();

// GET /api/v1/app/bootstrap
// Returns routing context for UI (available exams, default exam, and which UI shell to open).
router.get('/bootstrap', requireUserSession, async (req, res, next) => {
  try {
    const coreUserId = req.user && req.user.id;

    const result = await marketplaceAccess.listAvailableExamsForUser(coreUserId);
    const exams = result && Array.isArray(result.exams) ? result.exams : [];

    const routing = {
      source: result && result.source ? result.source : 'unknown',
      marketplaceConfigured: !!(result && result.marketplaceConfigured),
    };

    // In dev, surface marketplace errors to speed up configuration/debug.
    // In prod, keep responses generic (avoid leaking DB details).
    if (result && result.error) {
      routing.errorCode = 'MARKETPLACE_ACCESS_ERROR';
      if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') {
        routing.error = String(result.error);
      }
    }

    return res.json({
      ok: true,
      user: {
        id: coreUserId || null,
        nome: (req.user && req.user.nome) || null,
      },
      availableExams: exams,
      defaultExamId: marketplaceAccess.chooseDefaultExamId(exams),
      routing,
    });
  } catch (e) {
    return next(internalError('Internal error', 'APP_BOOTSTRAP_ERROR', { error: e && e.message ? String(e.message) : 'unknown' }));
  }
});

module.exports = router;
