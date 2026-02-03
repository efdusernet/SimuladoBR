const { logger } = require('../utils/logger');
const { badRequest, internalError, forbidden } = require('../middleware/errors');
const db = require('../models');

function isMissingQuestaoLikeTableError(err) {
	try {
		const code = err && (err.original && err.original.code ? err.original.code : err.code);
		if (code === '42P01') return true; // undefined_table
		const msg = String((err && (err.original && err.original.message ? err.original.message : err.message)) || '').toLowerCase();
		return msg.includes('questao_like') && msg.includes('does not exist');
	} catch (_) {
		return false;
	}
}

function isMissingUniqueForOnConflict(err) {
	try {
		const msg = String((err && (err.original && err.original.message ? err.original.message : err.message)) || '').toLowerCase();
		return msg.includes('no unique') && msg.includes('on conflict');
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

async function getCountsForQuestionIds(userId, questionIds) {
	const ids = Array.isArray(questionIds)
		? questionIds
			.map((n) => Number.parseInt(String(n), 10))
			.filter((n) => Number.isInteger(n) && n > 0)
		: [];
	if (!ids.length) return [];

	const bind = { user_id: userId };
	const placeholders = ids.map((id, idx) => {
		const key = `id_${idx}`;
		bind[key] = id;
		return `$${key}`;
	});
	const inList = placeholders.join(', ');

	const sql = `
		WITH ids AS (
			SELECT UNNEST(ARRAY[${inList}]::bigint[]) AS question_id
		), agg AS (
			SELECT ql.idquestao::bigint AS question_id,
			       SUM(ql."like")::int AS likes,
			       SUM(ql.dislike)::int AS dislikes
			  FROM public.questao_like ql
			 WHERE ql.idquestao IN (${inList})
			 GROUP BY ql.idquestao
		), me AS (
			SELECT ql.idquestao::bigint AS question_id,
			       (CASE WHEN ql."like" = 1 THEN 1 WHEN ql.dislike = 1 THEN -1 ELSE 0 END)::int AS my_vote
			  FROM public.questao_like ql
			 WHERE ql.idusario = $user_id
			   AND ql.idquestao IN (${inList})
		)
		SELECT ids.question_id,
		       COALESCE(agg.likes, 0)::int AS likes,
		       COALESCE(agg.dislikes, 0)::int AS dislikes,
		       COALESCE(me.my_vote, 0)::int AS my_vote
		  FROM ids
		  LEFT JOIN agg ON agg.question_id = ids.question_id
		  LEFT JOIN me ON me.question_id = ids.question_id
		 ORDER BY ids.question_id;
	`;

	return db.sequelize.query(sql, { type: db.sequelize.QueryTypes.SELECT, bind });
}

async function getQuestionFeedback(req, res, next) {
	try {
		const userId = req.user && req.user.id ? Number.parseInt(String(req.user.id), 10) : null;
		if (!userId || !Number.isInteger(userId) || userId <= 0) {
			return next(forbidden('Usuário inválido', 'QUESTION_FEEDBACK_INVALID_USER'));
		}

		const questionId = parseRequiredPositiveInt(req.params && (req.params.questionId || req.params.id));
		if (Number.isNaN(questionId)) {
			return next(badRequest('questionId inválido', 'QUESTION_FEEDBACK_INVALID_QUESTION_ID'));
		}

		const rows = await getCountsForQuestionIds(userId, [questionId]);
		const row = Array.isArray(rows) && rows.length ? rows[0] : null;
		return res.json({
			ok: true,
			questionId,
			likes: row ? row.likes : 0,
			dislikes: row ? row.dislikes : 0,
			myVote: row ? row.my_vote : 0,
		});
	} catch (err) {
		if (isMissingQuestaoLikeTableError(err)) {
			return next(
				internalError(
					'Tabela questao_like não existe (rode a migration 058_create_questao_like.sql).',
					'QUESTION_FEEDBACK_TABLE_MISSING',
					err
				)
			);
		}
		logger.error('Erro obtendo feedback de questão:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'QUESTION_FEEDBACK_GET_ERROR', err));
	}
}

async function batchQuestionFeedback(req, res, next) {
	try {
		const userId = req.user && req.user.id ? Number.parseInt(String(req.user.id), 10) : null;
		if (!userId || !Number.isInteger(userId) || userId <= 0) {
			return next(forbidden('Usuário inválido', 'QUESTION_FEEDBACK_INVALID_USER'));
		}

		const ids = req.body && (req.body.questionIds || req.body.ids);
		if (!Array.isArray(ids) || !ids.length) {
			return next(badRequest('questionIds é obrigatório', 'QUESTION_FEEDBACK_MISSING_IDS'));
		}

		const rows = await getCountsForQuestionIds(userId, ids);
		const byId = {};
		rows.forEach((r) => {
			byId[String(r.question_id)] = {
				likes: r.likes,
				dislikes: r.dislikes,
				myVote: r.my_vote,
			};
		});

		return res.json({ ok: true, byId });
	} catch (err) {
		if (isMissingQuestaoLikeTableError(err)) {
			return next(
				internalError(
					'Tabela questao_like não existe (rode a migration 058_create_questao_like.sql).',
					'QUESTION_FEEDBACK_TABLE_MISSING',
					err
				)
			);
		}
		logger.error('Erro batch feedback de questões:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'QUESTION_FEEDBACK_BATCH_ERROR', err));
	}
}

async function upsertQuestionFeedback(req, res, next) {
	try {
		const userId = req.user && req.user.id ? Number.parseInt(String(req.user.id), 10) : null;
		if (!userId || !Number.isInteger(userId) || userId <= 0) {
			return next(forbidden('Usuário inválido', 'QUESTION_FEEDBACK_INVALID_USER'));
		}

		const questionId = parseRequiredPositiveInt(req.params && (req.params.questionId || req.params.id));
		if (Number.isNaN(questionId)) {
			return next(badRequest('questionId inválido', 'QUESTION_FEEDBACK_INVALID_QUESTION_ID'));
		}

		const vote = parseVote(req.body && req.body.vote);
		if (Number.isNaN(vote)) {
			return next(badRequest('vote inválido', 'QUESTION_FEEDBACK_INVALID_VOTE'));
		}

		if (vote === 0) {
			await db.sequelize.query(
				`DELETE FROM public.questao_like
				  WHERE idusario = $user_id AND idquestao = $question_id;`,
				{ type: db.sequelize.QueryTypes.DELETE, bind: { user_id: userId, question_id: questionId } }
			);
		} else {
			const likeVal = vote === 1 ? 1 : 0;
			const dislikeVal = vote === -1 ? 1 : 0;
			await db.sequelize.query(
				`INSERT INTO public.questao_like (idquestao, idusario, "like", dislike)
				 VALUES ($question_id, $user_id, $like, $dislike)
				 ON CONFLICT (idquestao, idusario)
				 DO UPDATE SET "like" = EXCLUDED."like", dislike = EXCLUDED.dislike;`,
				{ type: db.sequelize.QueryTypes.INSERT, bind: { user_id: userId, question_id: questionId, like: likeVal, dislike: dislikeVal } }
			);
		}

		const rows = await getCountsForQuestionIds(userId, [questionId]);
		const row = Array.isArray(rows) && rows.length ? rows[0] : null;
		return res.json({
			ok: true,
			questionId,
			likes: row ? row.likes : 0,
			dislikes: row ? row.dislikes : 0,
			myVote: row ? row.my_vote : 0,
		});
	} catch (err) {
		if (isMissingQuestaoLikeTableError(err)) {
			return next(
				internalError(
					'Tabela questao_like não existe (rode a migration 058_create_questao_like.sql).',
					'QUESTION_FEEDBACK_TABLE_MISSING',
					err
				)
			);
		}
		if (isMissingUniqueForOnConflict(err)) {
			return next(
				internalError(
					'Questao_like sem índice único para (idquestao, idusario). Rode a migration 058_create_questao_like.sql.',
					'QUESTION_FEEDBACK_MISSING_UNIQUE',
					err
				)
			);
		}
		logger.error('Erro salvando feedback de questão:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'QUESTION_FEEDBACK_SAVE_ERROR', err));
	}
}

module.exports = {
	getQuestionFeedback,
	batchQuestionFeedback,
	upsertQuestionFeedback,
};
