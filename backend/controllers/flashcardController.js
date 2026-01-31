const { logger } = require('../utils/logger');
const { badRequest, internalError } = require('../middleware/errors');
const db = require('../models');
const userParamsStore = require('../services/userParamsStore');

function parseOptionalPositiveInt(value) {
	if (value == null) return null;
	const raw = String(value).trim();
	if (!raw) return null;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return NaN;
	return parsed;
}

function parseOptionalBoolean(value) {
	if (value == null) return null;
	const raw = String(value).trim().toLowerCase();
	if (!raw) return null;
	if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
	if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
	return NaN;
}

async function listFlashcards(req, res, next) {
	try {
		const user = req.userModel || null;
		const isBlocked = Boolean(user && user.BloqueioAtivado);
		let seed = null;
		if (isBlocked) {
			const params = await userParamsStore.getCachedParams({ maxAgeMs: 10_000 });
			const restrict = !(params && params.freeOnlySeedFlashcards === false);
			seed = restrict ? true : null;
		}

		const versionId = parseOptionalPositiveInt(req.query.versionId);
		if (Number.isNaN(versionId)) return next(badRequest('versionId inválido', 'FLASHCARD_INVALID_VERSION_ID'));

		const idprincipio = parseOptionalPositiveInt(req.query.idprincipio);
		if (Number.isNaN(idprincipio)) return next(badRequest('idprincipio inválido', 'FLASHCARD_INVALID_IDPRINCIPIO'));

		const iddominio_desempenho = parseOptionalPositiveInt(req.query.iddominio_desempenho);
		if (Number.isNaN(iddominio_desempenho)) return next(badRequest('iddominio_desempenho inválido', 'FLASHCARD_INVALID_IDDOMINIO_DESEMPENHO'));

		const basics = parseOptionalBoolean(req.query.basics);
		if (Number.isNaN(basics)) return next(badRequest('basics inválido', 'FLASHCARD_INVALID_BASICS'));

		const activeRaw = parseOptionalBoolean(req.query.active);
		if (Number.isNaN(activeRaw)) return next(badRequest('active inválido', 'FLASHCARD_INVALID_ACTIVE'));
		const active = activeRaw == null ? true : activeRaw;

		const rawLimit = req.query.limit;
		let limit = 200;
		if (rawLimit != null && String(rawLimit).trim() !== '') {
			const parsed = Number.parseInt(String(rawLimit), 10);
			if (!Number.isInteger(parsed) || parsed <= 0) {
				return next(badRequest('limit inválido', 'FLASHCARD_INVALID_LIMIT'));
			}
			limit = Math.min(parsed, 1000);
		}

		const rawOffset = req.query.offset;
		let offset = 0;
		if (rawOffset != null && String(rawOffset).trim() !== '') {
			const parsed = Number.parseInt(String(rawOffset), 10);
			if (!Number.isInteger(parsed) || parsed < 0) {
				return next(badRequest('offset inválido', 'FLASHCARD_INVALID_OFFSET'));
			}
			offset = parsed;
		}

		const sql = `
			SELECT
				f.id,
				f.pergunta,
				f.resposta,
				f.id_versao_pmbok,
				f.data_cadastro,
				f.data_alteracao,
				f.idprincipio,
				f.iddominio_desempenho,
				COALESCE(f.basics, FALSE) AS basics,
				COALESCE(f.active, TRUE) AS active,
				ecv.code AS versao_code
			FROM public.flashcard f
			LEFT JOIN public.exam_content_version ecv ON ecv.id = f.id_versao_pmbok
			WHERE ($versionId::int IS NULL OR f.id_versao_pmbok = $versionId)
				AND COALESCE(f.active, TRUE) = $active
				AND ($seed::boolean IS NULL OR COALESCE(f.seed, FALSE) = $seed)
				AND (
					(
						$idprincipio::int IS NOT NULL
						OR $iddominio_desempenho::int IS NOT NULL
						OR $basics::boolean IS NOT NULL
					)
					AND (
						(f.idprincipio = $idprincipio)
						OR (f.iddominio_desempenho = $iddominio_desempenho)
						OR (COALESCE(f.basics, FALSE) = $basics)
					)
				)
			ORDER BY f.id ASC
			LIMIT $limit::int
			OFFSET $offset::int;
		`;

		const rows = await db.sequelize.query(sql, {
			type: db.sequelize.QueryTypes.SELECT,
			bind: {
				versionId,
				idprincipio,
				iddominio_desempenho,
				basics,
				active,
				seed,
				limit,
				offset,
			},
		});

		return res.json({
			items: rows,
			meta: {
				versionId,
				idprincipio,
				iddominio_desempenho,
				basics,
				active,
				seed,
				limit,
				offset,
				count: rows.length,
			},
		});
	} catch (err) {
		logger.error('Erro listando flashcards:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'FLASHCARD_LIST_ERROR', err));
	}
}

module.exports = {
	listFlashcards,
};
