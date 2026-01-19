const { badRequest, internalError } = require('../middleware/errors');
const { safeGetFlashcardsInsights } = require('../services/flashcardsInsightsService');

function parseOptionalInt(value) {
  if (value == null) return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

async function getInsights(req, res, next) {
  try {
    const userId = req.user && req.user.id ? Number(req.user.id) : null;
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

    const minTotal = (() => {
      const n = parseOptionalInt(req.query.min_total);
      return Number.isFinite(n) ? n : 5;
    })();
    const topN = (() => {
      const n = parseOptionalInt(req.query.top_n);
      return Number.isFinite(n) ? n : 10;
    })();

    const result = await safeGetFlashcardsInsights(userId, { minTotal, topN });
    if (!result.ok) {
      return res.status(200).json({
        success: true,
        meta: { ok: false, ms: result.ms, error: result.error || 'Falha ao calcular insights de flashcards' },
        flashcards: null,
      });
    }

    return res.json({
      success: true,
      meta: { ok: true, ms: result.ms },
      flashcards: result.data,
    });
  } catch (err) {
    return next(internalError('Erro interno', 'FLASHCARDS_INSIGHTS_ERROR', err));
  }
}

module.exports = {
  getInsights,
};
