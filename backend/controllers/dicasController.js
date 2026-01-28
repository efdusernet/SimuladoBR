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

function isMissingDicasTableError(err) {
	try {
		const code = err && (err.original && err.original.code ? err.original.code : err.code);
		if (code === '42P01') return true; // undefined_table
		const msg = String((err && (err.original && err.original.message ? err.original.message : err.message)) || '').toLowerCase();
		return msg.includes('does not exist') && (msg.includes('relation "dicas"') || msg.includes('public.dicas'));
	} catch (_) {
		return false;
	}
}

async function getDicaDoDia(req, res, next) {
	try {
		// Default versionId aligns with current schema default (2)
		const versionId = parsePositiveInt(req.query.versionId) || 2;
		const anyVersion = String(req.query.anyVersion || '').trim().toLowerCase() === 'true';
		const effectiveVersionId = anyVersion ? null : versionId;

		const sql = `
			SELECT
				d.id,
				d.descricao,
				d.id_versao_pmbok,
				ecv.code AS versao_code
			FROM public.dicas d
			LEFT JOIN public.exam_content_version ecv ON ecv.id = d.id_versao_pmbok
			WHERE ($versionId::int IS NULL OR d.id_versao_pmbok = $versionId)
			ORDER BY random()
			LIMIT 1;
		`;

		const rows = await db.sequelize.query(sql, {
			type: db.sequelize.QueryTypes.SELECT,
			bind: { versionId: effectiveVersionId },
		});

		const item = rows && rows[0];
		if (!item) {
			return next(notFound('Nenhuma dica encontrada', 'DICAS_EMPTY'));
		}

		return res.json({ item });
	} catch (err) {
		if (isMissingDicasTableError(err)) {
			return next(
				internalError(
					'Tabela dicas não existe no banco (crie/rode a migration da tabela public.dicas).',
					'DICAS_TABLE_MISSING',
					err
				)
			);
		}
		logger.error('Erro buscando dica do dia:', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'DICAS_TODAY_ERROR', err));
	}
}

module.exports = {
	getDicaDoDia,
};
