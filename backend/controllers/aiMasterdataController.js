const { internalError } = require('../middleware/errors');
const { getQuestionClassificationMasterdata } = require('../services/masterdataService');

async function getQuestionClassification(req, res, next) {
  try {
    const masterdata = await getQuestionClassificationMasterdata();
    return res.json({
      success: true,
      meta: {
        scope: 'question-classification',
        fetchedAt: new Date().toISOString(),
      },
      masterdata,
    });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'Erro';
    return next(internalError('Falha ao carregar masterdata', 'AI_MASTERDATA_ERROR', { error: msg, code: e && e.code ? e.code : null, meta: e && e.meta ? e.meta : null }));
  }
}

module.exports = {
  getQuestionClassification,
};
