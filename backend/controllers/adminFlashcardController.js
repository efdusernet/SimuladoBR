const { logger } = require('../utils/logger');
const { badRequest, notFound, internalError } = require('../middleware/errors');
const db = require('../models');

function parsePositiveInt(value) {
	if (value == null) return null;
	const s = String(value).trim();
	if (!s) return null;
	const n = Number.parseInt(s, 10);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}

function normalizeText(value) {
	const s = String(value ?? '').trim();
	return s;
}

function parseNullableInt(value) {
	if (value == null) return null;
	const s = String(value).trim();
	if (!s) return null;
	const n = Number.parseInt(s, 10);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}

function parseBoolean(value, def = false) {
	if (value == null) return def;
	if (typeof value === 'boolean') return value;
	const s = String(value).trim().toLowerCase();
	if (s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on') return true;
	if (s === '0' || s === 'false' || s === 'no' || s === 'n' || s === 'off') return false;
	return def;
}

async function listFlashcards(req, res, next) {
	try {
		const versionId = parsePositiveInt(req.query.versionId);
		const q = normalizeText(req.query.q);

		const limit = Math.min(parsePositiveInt(req.query.limit) || 200, 1000);
		const offset = Math.max(parsePositiveInt(req.query.offset) || 0, 0);

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
				f.idabordagem,
				COALESCE(f.basics, FALSE) AS basics,
				ecv.code AS versao_code
			FROM public.flashcard f
			JOIN public.exam_content_version ecv ON ecv.id = f.id_versao_pmbok
			WHERE ($versionId::int IS NULL OR f.id_versao_pmbok = $versionId)
			  AND ($q::text = '' OR f.pergunta ILIKE '%' || $q || '%' OR f.resposta ILIKE '%' || $q || '%')
			ORDER BY f.id DESC
			LIMIT $limit
			OFFSET $offset;
		`;

		const items = await db.sequelize.query(sql, {
			type: db.sequelize.QueryTypes.SELECT,
			replacements: { versionId, q, limit, offset },
		});

		return res.json({ items, meta: { versionId, q, limit, offset, count: items.length } });
	} catch (err) {
		logger.error('Erro admin listando flashcards:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_FLASHCARD_LIST_ERROR', err));
	}
}

async function listVersions(req, res, next) {
	try {
		const sql = `
			SELECT id, code
			FROM public.exam_content_version
			ORDER BY id DESC;
		`;
		const items = await db.sequelize.query(sql, { type: db.sequelize.QueryTypes.SELECT });
		return res.json({ items });
	} catch (err) {
		logger.error('Erro admin listando versões ECO/PMBOK:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_FLASHCARD_VERSIONS_ERROR', err));
	}
}

async function createFlashcard(req, res, next) {
	try {
		const pergunta = normalizeText(req.body && req.body.pergunta);
		const resposta = normalizeText(req.body && req.body.resposta);
		const id_versao_pmbok = parsePositiveInt(req.body && req.body.id_versao_pmbok) || 2;
		const idprincipio = parseNullableInt(req.body && req.body.idprincipio);
		const iddominioDesempenho = parseNullableInt(
			req.body && (req.body.iddominio_desempenho ?? req.body['iddominio_desempenho'])
		);
		const idabordagem = parseNullableInt(req.body && req.body.idabordagem);
		const basics = parseBoolean(req.body && req.body.basics, false);

		if (!pergunta || !resposta) {
			return next(badRequest('pergunta e resposta são obrigatórios', 'FLASHCARD_MISSING_FIELDS'));
		}

		const sql = `
			WITH ins AS (
				INSERT INTO public.flashcard (pergunta, resposta, id_versao_pmbok, idprincipio, iddominio_desempenho, idabordagem, basics)
				VALUES ($pergunta, $resposta, $id_versao_pmbok, $idprincipio, $iddominio_desempenho, $idabordagem, $basics)
				RETURNING *
			)
			SELECT
				ins.id,
				ins.pergunta,
				ins.resposta,
				ins.id_versao_pmbok,
				ins.data_cadastro,
				ins.data_alteracao,
				ins.idprincipio,
				ins.iddominio_desempenho,
				ins.idabordagem,
				COALESCE(ins.basics, FALSE) AS basics,
				ecv.code AS versao_code
			FROM ins
			JOIN public.exam_content_version ecv ON ecv.id = ins.id_versao_pmbok;
		`;

		const rows = await db.sequelize.query(sql, {
			type: db.sequelize.QueryTypes.SELECT,
			replacements: { pergunta, resposta, id_versao_pmbok, idprincipio, iddominio_desempenho: iddominioDesempenho, idabordagem, basics },
		});
		const created = rows && rows[0];
		return res.status(201).json(created);
	} catch (err) {
		logger.error('Erro admin criando flashcard:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_FLASHCARD_CREATE_ERROR', err));
	}
}

async function updateFlashcard(req, res, next) {
	try {
		const id = parsePositiveInt(req.params.id);
		if (!id) return next(badRequest('id inválido', 'FLASHCARD_INVALID_ID'));

		const pergunta = normalizeText(req.body && req.body.pergunta);
		const resposta = normalizeText(req.body && req.body.resposta);
		const id_versao_pmbok = parsePositiveInt(req.body && req.body.id_versao_pmbok) || 2;
		const idprincipio = parseNullableInt(req.body && req.body.idprincipio);
		const iddominioDesempenho = parseNullableInt(
			req.body && (req.body.iddominio_desempenho ?? req.body['iddominio_desempenho'])
		);
		const idabordagem = parseNullableInt(req.body && req.body.idabordagem);
		const basics = parseBoolean(req.body && req.body.basics, false);

		if (!pergunta || !resposta) {
			return next(badRequest('pergunta e resposta são obrigatórios', 'FLASHCARD_MISSING_FIELDS'));
		}

		const sql = `
			WITH upd AS (
				UPDATE public.flashcard
				SET pergunta = $pergunta,
				    resposta = $resposta,
				    id_versao_pmbok = $id_versao_pmbok,
				    idprincipio = $idprincipio,
				    iddominio_desempenho = $iddominio_desempenho,
				    idabordagem = $idabordagem,
				    basics = $basics
				WHERE id = $id
				RETURNING *
			)
			SELECT
				upd.id,
				upd.pergunta,
				upd.resposta,
				upd.id_versao_pmbok,
				upd.data_cadastro,
				upd.data_alteracao,
				upd.idprincipio,
				upd.iddominio_desempenho,
				upd.idabordagem,
				COALESCE(upd.basics, FALSE) AS basics,
				ecv.code AS versao_code
			FROM upd
			JOIN public.exam_content_version ecv ON ecv.id = upd.id_versao_pmbok;
		`;

		const rows = await db.sequelize.query(sql, {
			type: db.sequelize.QueryTypes.SELECT,
			replacements: { id, pergunta, resposta, id_versao_pmbok, idprincipio, iddominio_desempenho: iddominioDesempenho, idabordagem, basics },
		});
		const updated = rows && rows[0];
		if (!updated) return next(notFound('Flashcard não encontrado', 'FLASHCARD_NOT_FOUND'));
		return res.json(updated);
	} catch (err) {
		logger.error('Erro admin atualizando flashcard:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_FLASHCARD_UPDATE_ERROR', err));
	}
}

async function deleteFlashcard(req, res, next) {
	try {
		const id = parsePositiveInt(req.params.id);
		if (!id) return next(badRequest('id inválido', 'FLASHCARD_INVALID_ID'));

		const sql = `DELETE FROM public.flashcard WHERE id = $id RETURNING id;`;
		const rows = await db.sequelize.query(sql, {
			type: db.sequelize.QueryTypes.SELECT,
			replacements: { id },
		});
		if (!rows || !rows.length) return next(notFound('Flashcard não encontrado', 'FLASHCARD_NOT_FOUND'));
		return res.json({ ok: true, id });
	} catch (err) {
		logger.error('Erro admin removendo flashcard:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_FLASHCARD_DELETE_ERROR', err));
	}
}

module.exports = {
	listFlashcards,
	listVersions,
	createFlashcard,
	updateFlashcard,
	deleteFlashcard,
};
