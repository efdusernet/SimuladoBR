const express = require('express');

const requireAdmin = require('../middleware/requireAdmin');
const { badRequest, internalError } = require('../middleware/errors');
const marketplaceAccess = require('../services/marketplaceAccessService');

const router = express.Router();

router.use(requireAdmin);

// GET /api/v1/admin/marketplace/access/debug/db
// Debug helper to confirm the marketplace connection target.
router.get('/debug/db', async (req, res, next) => {
  try {
    const { configured, sequelize } = require('../config/marketplaceDatabase');
    if (!configured || !sequelize) {
      return res.json({ ok: true, configured: false });
    }

    const [rows] = await sequelize.query('SELECT current_database() AS database, current_user AS user;');
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;

    const [regRows] = await sequelize.query(
      "SELECT to_regclass('marketplace.exam_catalog') AS exam_catalog, to_regclass('marketplace.user_exam_access') AS user_exam_access;"
    );
    const regRow = Array.isArray(regRows) && regRows[0] ? regRows[0] : null;

    return res.json({
      ok: true,
      configured: true,
      database: row ? row.database : null,
      user: row ? row.user : null,
      hasExamCatalogTable: !!(regRow && regRow.exam_catalog),
      hasUserExamAccessTable: !!(regRow && regRow.user_exam_access),
    });
  } catch (e) {
    return next(internalError('Internal error', 'MARKETPLACE_DEBUG_DB_ERROR', { error: e && e.message ? String(e.message) : 'unknown' }));
  }
});

// POST /api/v1/admin/marketplace/access/exam-access/grant
// Body: { coreUserId, examId, title?, startsAt?, expiresAt?, status? }
router.post('/exam-access/grant', async (req, res, next) => {
  try {
    const body = req.body || {};
    const coreUserId = body.coreUserId;
    const examId = body.examId;

    if (!coreUserId) return next(badRequest('coreUserId required', 'CORE_USER_ID_REQUIRED'));
    if (!examId) return next(badRequest('examId required', 'EXAM_ID_REQUIRED'));

    const result = await marketplaceAccess.grantUserExamAccess({
      coreUserId,
      examId,
      title: body.title,
      startsAt: body.startsAt,
      expiresAt: body.expiresAt,
      status: body.status,
    });

    if (!result.ok) {
      return next(badRequest('Grant failed', 'MARKETPLACE_ACCESS_GRANT_FAILED', { error: result.error || null }));
    }

    return res.json({ ok: true });
  } catch (e) {
    return next(internalError('Internal error', 'MARKETPLACE_ACCESS_GRANT_ERROR', { error: e && e.message ? String(e.message) : 'unknown' }));
  }
});

module.exports = router;
