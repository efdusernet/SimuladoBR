const { logger } = require('../utils/logger');
const { badRequest, internalError, forbidden } = require('../middleware/errors');
const db = require('../models');

function parseRequiredPositiveInt(value) {
	const raw = String(value ?? '').trim();
	if (!raw) return NaN;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return NaN;
	return parsed;
}

function parseRequiredBoolean(value) {
	if (value === true || value === false) return value;
	const raw = String(value ?? '').trim().toLowerCase();
	if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
	if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
	return NaN;
}

async function recordScore(req, res, next) {
	try {
		const userId = req.user && req.user.id ? Number.parseInt(String(req.user.id), 10) : null;
		if (!userId || !Number.isInteger(userId) || userId <= 0) {
			return next(forbidden('Usuário inválido', 'FLASHCARD_SCORE_INVALID_USER'));
		}

		const flashcardId = parseRequiredPositiveInt(req.body && req.body.flashcardId);
		if (Number.isNaN(flashcardId)) {
			return next(badRequest('flashcardId inválido', 'FLASHCARD_SCORE_INVALID_FLASHCARD_ID'));
		}

		const correct = parseRequiredBoolean(req.body && req.body.correct);
		if (Number.isNaN(correct)) {
			return next(badRequest('correct inválido', 'FLASHCARD_SCORE_INVALID_CORRECT'));
		}

		// Load flashcard to snapshot its classification at answer time
		const fc = await db.sequelize.query(
			`SELECT id, id_versao_pmbok, idprincipio, iddominio_desempenho, idabordagem, COALESCE(basics, FALSE) AS basics
			   FROM public.flashcard
			  WHERE id = $id
			  LIMIT 1;`,
			{ type: db.sequelize.QueryTypes.SELECT, bind: { id: flashcardId } }
		);

		const flashcard = Array.isArray(fc) && fc.length ? fc[0] : null;
		if (!flashcard) {
			return next(badRequest('Flashcard não encontrado', 'FLASHCARD_SCORE_NOT_FOUND'));
		}

		const inserted = await db.sequelize.query(
			`INSERT INTO public.flashcard_score (
				user_id, flashcard_id, correct,
				id_versao_pmbok, idprincipio, iddominio_desempenho, idabordagem, basics
			) VALUES (
				$user_id, $flashcard_id, $correct,
				$id_versao_pmbok, $idprincipio, $iddominio_desempenho, $idabordagem, $basics
			)
			RETURNING id, created_at;`,
			{
				type: db.sequelize.QueryTypes.INSERT,
				bind: {
					user_id: userId,
					flashcard_id: flashcardId,
					correct,
					id_versao_pmbok: flashcard.id_versao_pmbok ?? null,
					idprincipio: flashcard.idprincipio ?? null,
					iddominio_desempenho: flashcard.iddominio_desempenho ?? null,
					idabordagem: flashcard.idabordagem ?? null,
					basics: !!flashcard.basics,
				},
			}
		);

		const row = Array.isArray(inserted) && inserted.length && Array.isArray(inserted[0]) && inserted[0].length
			? inserted[0][0]
			: null;

		return res.json({
			ok: true,
			scoreId: row && row.id != null ? row.id : null,
			createdAt: row && row.created_at ? row.created_at : null,
		});
	} catch (err) {
		logger.error('Erro registrando pontuação de flashcard:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'FLASHCARD_SCORE_ERROR', err));
	}
}

module.exports = {
	recordScore,
};
