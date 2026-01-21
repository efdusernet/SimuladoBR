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

function parseOptionalPositiveInt(value) {
	if (value == null) return null;
	const raw = String(value).trim();
	if (!raw) return null;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return NaN;
	return parsed;
}

async function createAttempt(req, res, next) {
	try {
		const userId = req.user && req.user.id ? Number.parseInt(String(req.user.id), 10) : null;
		if (!userId || !Number.isInteger(userId) || userId <= 0) {
			return next(forbidden('Usuário inválido', 'FLASHCARD_ATTEMPT_INVALID_USER'));
		}

		const id_versao_pmbok = parseOptionalPositiveInt(req.body && req.body.versionId);
		if (Number.isNaN(id_versao_pmbok)) {
			return next(badRequest('versionId inválido', 'FLASHCARD_ATTEMPT_INVALID_VERSION_ID'));
		}

		const inserted = await db.sequelize.query(
			`INSERT INTO public.flashcard_attempt (user_id, id_versao_pmbok)
			 VALUES ($user_id, $id_versao_pmbok)
			 RETURNING id, started_at;`,
			{ type: db.sequelize.QueryTypes.INSERT, bind: { user_id: userId, id_versao_pmbok } }
		);

		const row = Array.isArray(inserted) && inserted.length && Array.isArray(inserted[0]) && inserted[0].length
			? inserted[0][0]
			: null;

		return res.json({ ok: true, attemptId: row && row.id != null ? row.id : null, startedAt: row && row.started_at ? row.started_at : null });
	} catch (err) {
		logger.error('Erro criando flashcard_attempt:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'FLASHCARD_ATTEMPT_CREATE_ERROR', err));
	}
}

async function upsertAnswer(req, res, next) {
	try {
		const userId = req.user && req.user.id ? Number.parseInt(String(req.user.id), 10) : null;
		if (!userId || !Number.isInteger(userId) || userId <= 0) {
			return next(forbidden('Usuário inválido', 'FLASHCARD_ATTEMPT_INVALID_USER'));
		}

		const attemptId = parseRequiredPositiveInt(req.params && req.params.attemptId);
		if (Number.isNaN(attemptId)) {
			return next(badRequest('attemptId inválido', 'FLASHCARD_ATTEMPT_INVALID_ATTEMPT_ID'));
		}

		const flashcardId = parseRequiredPositiveInt(req.body && req.body.flashcardId);
		if (Number.isNaN(flashcardId)) {
			return next(badRequest('flashcardId inválido', 'FLASHCARD_ATTEMPT_INVALID_FLASHCARD_ID'));
		}

		const correct = parseRequiredBoolean(req.body && req.body.correct);
		if (Number.isNaN(correct)) {
			return next(badRequest('correct inválido', 'FLASHCARD_ATTEMPT_INVALID_CORRECT'));
		}

		// Ensure attempt belongs to user
		const attemptRows = await db.sequelize.query(
			`SELECT id, user_id
			   FROM public.flashcard_attempt
			  WHERE id = $id
			  LIMIT 1;`,
			{ type: db.sequelize.QueryTypes.SELECT, bind: { id: attemptId } }
		);
		const attempt = Array.isArray(attemptRows) && attemptRows.length ? attemptRows[0] : null;
		if (!attempt) {
			return next(badRequest('Tentativa não encontrada', 'FLASHCARD_ATTEMPT_NOT_FOUND'));
		}
		if (Number(attempt.user_id) !== Number(userId)) {
			return next(forbidden('Tentativa não pertence ao usuário', 'FLASHCARD_ATTEMPT_FORBIDDEN'));
		}

		// Snapshot flashcard classification
		const fcRows = await db.sequelize.query(
			`SELECT id, id_versao_pmbok, idprincipio, iddominio_desempenho, COALESCE(basics, FALSE) AS basics
			   FROM public.flashcard
			  WHERE id = $id
			  LIMIT 1;`,
			{ type: db.sequelize.QueryTypes.SELECT, bind: { id: flashcardId } }
		);
		const flashcard = Array.isArray(fcRows) && fcRows.length ? fcRows[0] : null;
		if (!flashcard) {
			return next(badRequest('Flashcard não encontrado', 'FLASHCARD_ATTEMPT_FLASHCARD_NOT_FOUND'));
		}

		const upserted = await db.sequelize.query(
			`INSERT INTO public.flashcard_attempt_answer (
				attempt_id, user_id, flashcard_id, correct,
				id_versao_pmbok, idprincipio, iddominio_desempenho, basics,
				created_at, updated_at
			) VALUES (
				$attempt_id, $user_id, $flashcard_id, $correct,
				$id_versao_pmbok, $idprincipio, $iddominio_desempenho, $basics,
				NOW(), NOW()
			)
			ON CONFLICT (attempt_id, flashcard_id)
			DO UPDATE SET
				correct = EXCLUDED.correct,
				id_versao_pmbok = EXCLUDED.id_versao_pmbok,
				idprincipio = EXCLUDED.idprincipio,
				iddominio_desempenho = EXCLUDED.iddominio_desempenho,
				basics = EXCLUDED.basics,
				updated_at = NOW()
			RETURNING id, correct, updated_at;`,
			{
				type: db.sequelize.QueryTypes.INSERT,
				bind: {
					attempt_id: attemptId,
					user_id: userId,
					flashcard_id: flashcardId,
					correct,
					id_versao_pmbok: flashcard.id_versao_pmbok ?? null,
					idprincipio: flashcard.idprincipio ?? null,
					iddominio_desempenho: flashcard.iddominio_desempenho ?? null,
					basics: !!flashcard.basics,
				},
			}
		);

		const row = Array.isArray(upserted) && upserted.length && Array.isArray(upserted[0]) && upserted[0].length
			? upserted[0][0]
			: null;

		return res.json({ ok: true, attemptId, flashcardId, correct: row ? row.correct : correct, updatedAt: row ? row.updated_at : null });
	} catch (err) {
		logger.error('Erro salvando resposta de flashcard_attempt:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'FLASHCARD_ATTEMPT_ANSWER_ERROR', err));
	}
}

module.exports = {
	createAttempt,
	upsertAnswer,
};
