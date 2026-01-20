const { logger } = require('../utils/logger');
const { badRequest, notFound, internalError } = require('../middleware/errors');
const db = require('../models');

function isMissingDicasTableError(err) {
	try {
		const code = err && (err.original && err.original.code ? err.original.code : err.code);
		if (code === '42P01') return true; // undefined_table
		const msg = String((err && (err.original && err.original.message ? err.original.message : err.message)) || '').toLowerCase();
		return (
			msg.includes('does not exist') &&
			(
				msg.includes('relation "dicas"') ||
				msg.includes('public.dicas')
			)
		);
	} catch (_) {
		return false;
	}
}

function parsePositiveInt(value) {
	if (value == null) return null;
	const s = String(value).trim();
	if (!s) return null;
	const n = Number.parseInt(s, 10);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}

function normalizeText(value) {
	return String(value ?? '').trim();
}

async function listDicas(req, res, next) {
	try {
		const versionId = parsePositiveInt(req.query.versionId);
		const q = normalizeText(req.query.q);

		const limit = Math.min(parsePositiveInt(req.query.limit) || 200, 1000);
		const offset = Math.max(parsePositiveInt(req.query.offset) || 0, 0);

		const sql = `
			SELECT
				d.id,
				d.descricao,
				d.id_versao_pmbok,
				ecv.code AS versao_code
			FROM public.dicas d
			LEFT JOIN public.exam_content_version ecv ON ecv.id = d.id_versao_pmbok
			WHERE ($versionId::int IS NULL OR d.id_versao_pmbok = $versionId)
			  AND ($q::text = '' OR d.descricao ILIKE '%' || $q || '%')
			ORDER BY d.id DESC
			LIMIT $limit
			OFFSET $offset;
		`;

		const items = await db.sequelize.query(sql, {
			type: db.sequelize.QueryTypes.SELECT,
			bind: { versionId, q, limit, offset },
		});

		return res.json({ items, meta: { versionId, q, limit, offset, count: items.length } });
	} catch (err) {
		if (isMissingDicasTableError(err)) {
			return next(
				internalError(
					'Tabela dicas não existe no banco (crie/rode a migration da tabela public.dicas).',
					'ADMIN_DICAS_TABLE_MISSING',
					err
				)
			);
		}
		logger.error('Erro admin listando dicas:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_DICAS_LIST_ERROR', err));
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
		logger.error('Erro admin listando versões (dicas):', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_DICAS_VERSIONS_ERROR', err));
	}
}

async function createDica(req, res, next) {
	try {
		const descricao = normalizeText(req.body && req.body.descricao);
		const id_versao_pmbok = parsePositiveInt(req.body && req.body.id_versao_pmbok) || 2;

		if (!descricao) {
			return next(badRequest('descricao é obrigatória', 'DICAS_MISSING_DESCRICAO'));
		}

		const sql = `
			WITH ins AS (
				INSERT INTO public.dicas (descricao, id_versao_pmbok)
				VALUES ($descricao, $id_versao_pmbok)
				RETURNING *
			)
			SELECT
				ins.id,
				ins.descricao,
				ins.id_versao_pmbok,
				ecv.code AS versao_code
			FROM ins
			LEFT JOIN public.exam_content_version ecv ON ecv.id = ins.id_versao_pmbok;
		`;

		const rows = await db.sequelize.query(sql, {
			type: db.sequelize.QueryTypes.SELECT,
			bind: { descricao, id_versao_pmbok },
		});
		const created = rows && rows[0];
		return res.status(201).json(created);
	} catch (err) {
		logger.error('Erro admin criando dica:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_DICAS_CREATE_ERROR', err));
	}
}

async function updateDica(req, res, next) {
	try {
		const id = parsePositiveInt(req.params.id);
		if (!id) return next(badRequest('id inválido', 'DICAS_INVALID_ID'));

		const descricao = normalizeText(req.body && req.body.descricao);
		const id_versao_pmbok = parsePositiveInt(req.body && req.body.id_versao_pmbok) || 2;

		if (!descricao) {
			return next(badRequest('descricao é obrigatória', 'DICAS_MISSING_DESCRICAO'));
		}

		const sql = `
			WITH upd AS (
				UPDATE public.dicas
				SET descricao = $descricao,
				    id_versao_pmbok = $id_versao_pmbok
				WHERE id = $id
				RETURNING *
			)
			SELECT
				upd.id,
				upd.descricao,
				upd.id_versao_pmbok,
				ecv.code AS versao_code
			FROM upd
			LEFT JOIN public.exam_content_version ecv ON ecv.id = upd.id_versao_pmbok;
		`;

		const rows = await db.sequelize.query(sql, {
			type: db.sequelize.QueryTypes.SELECT,
			bind: { id, descricao, id_versao_pmbok },
		});
		const updated = rows && rows[0];
		if (!updated) return next(notFound('Dica não encontrada', 'DICAS_NOT_FOUND'));
		return res.json(updated);
	} catch (err) {
		logger.error('Erro admin atualizando dica:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_DICAS_UPDATE_ERROR', err));
	}
}

async function deleteDica(req, res, next) {
	try {
		const id = parsePositiveInt(req.params.id);
		if (!id) return next(badRequest('id inválido', 'DICAS_INVALID_ID'));

		const sql = `DELETE FROM public.dicas WHERE id = $id RETURNING id;`;
		const rows = await db.sequelize.query(sql, {
			type: db.sequelize.QueryTypes.SELECT,
			bind: { id },
		});

		if (!rows || !rows.length) return next(notFound('Dica não encontrada', 'DICAS_NOT_FOUND'));
		return res.json({ ok: true, id });
	} catch (err) {
		logger.error('Erro admin removendo dica:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_DICAS_DELETE_ERROR', err));
	}
}

module.exports = {
	listDicas,
	listVersions,
	createDica,
	updateDica,
	deleteDica,
};
