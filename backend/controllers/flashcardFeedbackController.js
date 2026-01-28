const { logger } = require('../utils/logger');
const { badRequest, internalError, forbidden } = require('../middleware/errors');
const db = require('../models');

function isMissingFeedbackTableError(err) {
	try {
		const code = err && (err.original && err.original.code ? err.original.code : err.code);
		if (code === '42P01') return true; // undefined_table
		const msg = String((err && (err.original && err.original.message ? err.original.message : err.message)) || '').toLowerCase();
		return msg.includes('flashcard_feedback') && msg.includes('does not exist');
	} catch (_) {
		return false;
	}
}

function parseRequiredPositiveInt(value) {
	const raw = String(value ?? '').trim();
	if (!raw) return NaN;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return NaN;
	return parsed;
}

function parseVote(value) {
	if (value === 1 || value === -1 || value === 0) return value;
	const raw = String(value ?? '').trim();
	if (!raw) return NaN;
	const parsed = Number.parseInt(raw, 10);
	if (parsed === 1 || parsed === -1 || parsed === 0) return parsed;
	return NaN;
}

async function getCountsForFlashcardIds(userId, flashcardIds) {
	const ids = Array.isArray(flashcardIds)
		? flashcardIds
			.map((n) => Number.parseInt(String(n), 10))
			.filter((n) => Number.isInteger(n) && n > 0)
		: [];
	if (!ids.length) return [];

	// Build a safe IN() placeholder list with bind params.
	const bind = { user_id: userId };
	const placeholders = ids.map((id, idx) => {
		const key = `id_${idx}`;
		bind[key] = id;
		return `$${key}`;
	});
	const inList = placeholders.join(', ');

	const sql = `
		WITH ids AS (
			SELECT UNNEST(ARRAY[${inList}]::bigint[]) AS flashcard_id
		), agg AS (
			SELECT f.flashcard_id,
				   SUM(CASE WHEN f.vote = 1 THEN 1 ELSE 0 END)::int AS likes,
				   SUM(CASE WHEN f.vote = -1 THEN 1 ELSE 0 END)::int AS dislikes
			  FROM public.flashcard_feedback f
		 WHERE f.flashcard_id IN (${inList})
		 GROUP BY f.flashcard_id
		), me AS (
			SELECT f.flashcard_id, f.vote::int AS my_vote
			  FROM public.flashcard_feedback f
			 WHERE f.user_id = $user_id
			   AND f.flashcard_id IN (${inList})
		)
		SELECT ids.flashcard_id,
		       COALESCE(agg.likes, 0)::int AS likes,
		       COALESCE(agg.dislikes, 0)::int AS dislikes,
		       COALESCE(me.my_vote, 0)::int AS my_vote
		  FROM ids
		  LEFT JOIN agg ON agg.flashcard_id = ids.flashcard_id
		  LEFT JOIN me ON me.flashcard_id = ids.flashcard_id
		 ORDER BY ids.flashcard_id;
	`;

	return db.sequelize.query(sql, { type: db.sequelize.QueryTypes.SELECT, bind });
}

async function getFlashcardFeedback(req, res, next) {
	try {
		const userId = req.user && req.user.id ? Number.parseInt(String(req.user.id), 10) : null;
		if (!userId || !Number.isInteger(userId) || userId <= 0) {
			return next(forbidden('Usuário inválido', 'FLASHCARD_FEEDBACK_INVALID_USER'));
		}

		const flashcardId = parseRequiredPositiveInt(req.params && (req.params.flashcardId || req.params.id));
		if (Number.isNaN(flashcardId)) {
			return next(badRequest('flashcardId inválido', 'FLASHCARD_FEEDBACK_INVALID_FLASHCARD_ID'));
		}

		const rows = await getCountsForFlashcardIds(userId, [flashcardId]);
		const row = Array.isArray(rows) && rows.length ? rows[0] : null;
		return res.json({
			ok: true,
			flashcardId,
			likes: row ? row.likes : 0,
			dislikes: row ? row.dislikes : 0,
			myVote: row ? row.my_vote : 0,
		});
	} catch (err) {
		if (isMissingFeedbackTableError(err)) {
			return next(
				internalError(
					'Tabela flashcard_feedback não existe (rode a migration 054_create_flashcard_feedback.sql).',
					'FLASHCARD_FEEDBACK_TABLE_MISSING',
					err
				)
			);
		}
		logger.error('Erro obtendo feedback de flashcard:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'FLASHCARD_FEEDBACK_GET_ERROR', err));
	}
}

async function batchFlashcardFeedback(req, res, next) {
	try {
		const userId = req.user && req.user.id ? Number.parseInt(String(req.user.id), 10) : null;
		if (!userId || !Number.isInteger(userId) || userId <= 0) {
			return next(forbidden('Usuário inválido', 'FLASHCARD_FEEDBACK_INVALID_USER'));
		}

		const ids = req.body && (req.body.flashcardIds || req.body.ids);
		if (!Array.isArray(ids) || !ids.length) {
			return next(badRequest('flashcardIds é obrigatório', 'FLASHCARD_FEEDBACK_MISSING_IDS'));
		}

		const rows = await getCountsForFlashcardIds(userId, ids);
		const byId = {};
		rows.forEach((r) => {
			byId[String(r.flashcard_id)] = {
				likes: r.likes,
				dislikes: r.dislikes,
				myVote: r.my_vote,
			};
		});

		return res.json({ ok: true, byId });
	} catch (err) {
		if (isMissingFeedbackTableError(err)) {
			return next(
				internalError(
					'Tabela flashcard_feedback não existe (rode a migration 054_create_flashcard_feedback.sql).',
					'FLASHCARD_FEEDBACK_TABLE_MISSING',
					err
				)
			);
		}
		logger.error('Erro batch feedback de flashcards:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'FLASHCARD_FEEDBACK_BATCH_ERROR', err));
	}
}

async function upsertFlashcardFeedback(req, res, next) {
	try {
		const userId = req.user && req.user.id ? Number.parseInt(String(req.user.id), 10) : null;
		if (!userId || !Number.isInteger(userId) || userId <= 0) {
			return next(forbidden('Usuário inválido', 'FLASHCARD_FEEDBACK_INVALID_USER'));
		}

		const flashcardId = parseRequiredPositiveInt(req.params && (req.params.flashcardId || req.params.id));
		if (Number.isNaN(flashcardId)) {
			return next(badRequest('flashcardId inválido', 'FLASHCARD_FEEDBACK_INVALID_FLASHCARD_ID'));
		}

		const vote = parseVote(req.body && req.body.vote);
		if (Number.isNaN(vote)) {
			return next(badRequest('vote inválido', 'FLASHCARD_FEEDBACK_INVALID_VOTE'));
		}

		// vote=0 means remove my vote
		if (vote === 0) {
			await db.sequelize.query(
				`DELETE FROM public.flashcard_feedback
				  WHERE user_id = $user_id AND flashcard_id = $flashcard_id;`,
				{ type: db.sequelize.QueryTypes.DELETE, bind: { user_id: userId, flashcard_id: flashcardId } }
			);
		} else {
			await db.sequelize.query(
				`INSERT INTO public.flashcard_feedback (user_id, flashcard_id, vote, created_at, updated_at)
				 VALUES ($user_id, $flashcard_id, $vote, NOW(), NOW())
				 ON CONFLICT (user_id, flashcard_id)
				 DO UPDATE SET vote = EXCLUDED.vote, updated_at = NOW();`,
				{ type: db.sequelize.QueryTypes.INSERT, bind: { user_id: userId, flashcard_id: flashcardId, vote } }
			);
		}

		const rows = await getCountsForFlashcardIds(userId, [flashcardId]);
		const row = Array.isArray(rows) && rows.length ? rows[0] : null;
		return res.json({
			ok: true,
			flashcardId,
			likes: row ? row.likes : 0,
			dislikes: row ? row.dislikes : 0,
			myVote: row ? row.my_vote : 0,
		});
	} catch (err) {
		if (isMissingFeedbackTableError(err)) {
			return next(
				internalError(
					'Tabela flashcard_feedback não existe (rode a migration 054_create_flashcard_feedback.sql).',
					'FLASHCARD_FEEDBACK_TABLE_MISSING',
					err
				)
			);
		}
		logger.error('Erro salvando feedback de flashcard:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'FLASHCARD_FEEDBACK_SAVE_ERROR', err));
	}
}

module.exports = {
	getFlashcardFeedback,
	batchFlashcardFeedback,
	upsertFlashcardFeedback,
};
