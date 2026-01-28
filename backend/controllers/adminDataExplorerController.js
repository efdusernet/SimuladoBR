const { logger } = require('../utils/logger');
const { badRequest, internalError } = require('../middleware/errors');
const db = require('../models');

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
const MAX_OFFSET = 200000;

const TABLE_DENYLIST = [
	/token/i,
	/session/i,
	/password/i,
	/secret/i,
	/credential/i,
	/audit/i,
];

function quoteIdent(name) {
	return '"' + String(name).replace(/"/g, '""') + '"';
}

function sanitizeTableName(name) {
	const raw = String(name || '').trim();
	if (!raw) return null;
	// Allow any case-sensitive identifier (we still validate against metadata later)
	return raw;
}

function isDeniedTable(tableName) {
	return TABLE_DENYLIST.some(re => re.test(String(tableName || '')));
}

async function listTables(req, res, next) {
	try {
		const rows = await db.sequelize.query(
			`SELECT table_name
			   FROM information_schema.tables
			  WHERE table_schema = 'public'
			    AND table_type = 'BASE TABLE'
			  ORDER BY table_name ASC;`,
			{ type: db.sequelize.QueryTypes.SELECT }
		);

		const tables = (Array.isArray(rows) ? rows : [])
			.map(r => r && r.table_name ? String(r.table_name) : null)
			.filter(Boolean)
			.filter(t => !isDeniedTable(t));

		return res.json({ tables });
	} catch (err) {
		logger.error('Erro listando tabelas (data explorer):', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_DATAEXPLORER_LIST_TABLES_ERROR', err));
	}
}

async function listColumns(req, res, next) {
	try {
		const table = sanitizeTableName(req.params && req.params.table);
		if (!table) return next(badRequest('Tabela inválida', 'ADMIN_DATAEXPLORER_INVALID_TABLE'));
		if (isDeniedTable(table)) return next(badRequest('Tabela não permitida', 'ADMIN_DATAEXPLORER_TABLE_DENIED'));

		const rows = await db.sequelize.query(
			`SELECT column_name, data_type
			   FROM information_schema.columns
			  WHERE table_schema = 'public'
			    AND table_name = $table
			  ORDER BY ordinal_position ASC;`,
			{ type: db.sequelize.QueryTypes.SELECT, bind: { table } }
		);

		const columns = (Array.isArray(rows) ? rows : []).map(r => ({
			name: r && r.column_name ? String(r.column_name) : '',
			type: r && r.data_type ? String(r.data_type) : '',
		})).filter(c => c.name);

		if (!columns.length) {
			return next(badRequest('Tabela não encontrada ou sem colunas', 'ADMIN_DATAEXPLORER_TABLE_NOT_FOUND'));
		}

		return res.json({ table, columns });
	} catch (err) {
		logger.error('Erro listando colunas (data explorer):', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_DATAEXPLORER_LIST_COLUMNS_ERROR', err));
	}
}

function clampInt(n, min, max, def) {
	const parsed = Number.parseInt(String(n ?? ''), 10);
	if (!Number.isInteger(parsed)) return def;
	if (parsed < min) return min;
	if (parsed > max) return max;
	return parsed;
}

function normalizeIdentifierList(list) {
	return (Array.isArray(list) ? list : [])
		.map(x => String(x || '').trim())
		.filter(Boolean);
}

function normalizeString(value) {
	return String(value ?? '').trim();
}

function normalizePgType(dataType) {
	const t = String(dataType || '').trim().toLowerCase();
	if (!t) return 'text';
	if (t === 'integer') return 'int';
	if (t === 'bigint') return 'bigint';
	if (t === 'smallint') return 'smallint';
	if (t === 'numeric' || t === 'decimal' || t === 'real' || t === 'double precision') return 'numeric';
	if (t === 'boolean') return 'boolean';
	if (t === 'uuid') return 'uuid';
	if (t === 'date') return 'date';
	if (t === 'timestamp without time zone') return 'timestamp';
	if (t === 'timestamp with time zone') return 'timestamptz';
	// default fallback
	return 'text';
}

function parseBooleanLoose(value) {
	if (value === true || value === false) return value;
	const s = String(value ?? '').trim().toLowerCase();
	if (s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'on') return true;
	if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === 'off') return false;
	return NaN;
}

function coerceScalar(pgType, value) {
	// Keep nulls as-is
	if (value == null) return null;
	if (pgType === 'boolean') {
		const b = parseBooleanLoose(value);
		return Number.isNaN(b) ? NaN : b;
	}
	if (pgType === 'int' || pgType === 'bigint' || pgType === 'smallint') {
		const n = Number.parseInt(String(value).trim(), 10);
		return Number.isInteger(n) ? n : NaN;
	}
	if (pgType === 'numeric') {
		const n = Number(String(value).trim());
		return Number.isFinite(n) ? n : NaN;
	}
	// For date/time/uuid/text keep string (DB will cast)
	return String(value);
}

function splitInList(raw) {
	return String(raw ?? '')
		.split(',')
		.map(x => x.trim())
		.filter(Boolean);
}

function splitBetween(raw) {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	if (s.includes('..')) {
		const parts = s.split('..').map(x => x.trim());
		if (parts.length >= 2 && parts[0] && parts[1]) return [parts[0], parts[1]];
		return null;
	}
	const parts = s.split(',').map(x => x.trim()).filter(Boolean);
	if (parts.length >= 2) return [parts[0], parts[1]];
	return null;
}

async function query(req, res, next) {
	try {
		const built = await buildSqlAndBind(req.body);
		const sqlPreviewExpanded = expandSqlWithBind(built.sql, built.bind);
		const rows = await db.sequelize.query(built.sql, {
			type: db.sequelize.QueryTypes.SELECT,
			bind: built.bind,
		});

		const arr = Array.isArray(rows) ? rows : [];
		const hasMore = arr.length > built.limit;
		const outRows = hasMore ? arr.slice(0, built.limit) : arr;

		return res.json({
			rows: outRows,
			hasMore,
			sqlPreview: built.sql,
			sqlPreviewExpanded,
			bind: built.bind,
			meta: { table: built.table, limit: built.limit, offset: built.offset, count: outRows.length },
		});
	} catch (err) {
		logger.error('Erro executando query (data explorer):', { error: err.message, stack: err.stack });
		return next(internalError('Erro interno', 'ADMIN_DATAEXPLORER_QUERY_ERROR', err));
	}
}

async function preview(req, res, next) {
	try {
		const built = await buildSqlAndBind(req.body);
		return res.json({
			sqlPreview: built.sql,
			sqlPreviewExpanded: expandSqlWithBind(built.sql, built.bind),
			bind: built.bind,
			meta: { table: built.table, limit: built.limit, offset: built.offset },
		});
	} catch (err) {
		logger.error('Erro gerando preview (data explorer):', { error: err.message, stack: err.stack });
		// preserve client-friendly errors for validation issues
		return next(err && err.code ? err : internalError('Erro interno', 'ADMIN_DATAEXPLORER_PREVIEW_ERROR', err));
	}
}

function sqlLiteral(value) {
	if (value == null) return 'NULL';
	if (Array.isArray(value)) {
		return `ARRAY[${value.map(sqlLiteral).join(', ')}]`;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : 'NULL';
	}
	if (typeof value === 'boolean') {
		return value ? 'TRUE' : 'FALSE';
	}
	// Default: string literal
	const s = String(value);
	return `'${s.replace(/'/g, "''")}'`;
}

function expandSqlWithBind(sql, bind) {
	const sourceSql = String(sql || '');
	const params = (bind && typeof bind === 'object') ? bind : {};
	// Replace $p1, $p2... with their literal values (for display only)
	return sourceSql.replace(/\$p(\d+)\b/g, (m, n) => {
		const key = `p${n}`;
		if (!Object.prototype.hasOwnProperty.call(params, key)) return m;
		return sqlLiteral(params[key]);
	});
}

async function buildSqlAndBind(body) {
	const table = sanitizeTableName(body && body.table);
	if (!table) throw badRequest('Tabela inválida', 'ADMIN_DATAEXPLORER_INVALID_TABLE');
	if (isDeniedTable(table)) throw badRequest('Tabela não permitida', 'ADMIN_DATAEXPLORER_TABLE_DENIED');

	// Load table columns for validation
	const colsRows = await db.sequelize.query(
		`SELECT column_name, data_type
		   FROM information_schema.columns
		  WHERE table_schema = 'public'
		    AND table_name = $table;`,
		{ type: db.sequelize.QueryTypes.SELECT, bind: { table } }
	);
	const columnSet = new Set((Array.isArray(colsRows) ? colsRows : []).map(r => String(r.column_name)));
	const columnType = new Map(
		(Array.isArray(colsRows) ? colsRows : []).map(r => [String(r.column_name), normalizePgType(r.data_type)])
	);
	if (!columnSet.size) throw badRequest('Tabela não encontrada', 'ADMIN_DATAEXPLORER_TABLE_NOT_FOUND');

	const columns = normalizeIdentifierList(body && body.columns);
	const groupBy = normalizeIdentifierList(body && body.groupBy);
	const aggregates = Array.isArray(body && body.aggregates) ? body.aggregates : [];
	const filters = Array.isArray(body && body.filters) ? body.filters : [];
	const having = Array.isArray(body && body.having) ? body.having : [];

	const limit = clampInt(body && body.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
	const offset = clampInt(body && body.offset, 0, MAX_OFFSET, 0);

	const orderBy = body && body.orderBy ? body.orderBy : null;
	const orderByCol = orderBy && orderBy.column ? String(orderBy.column).trim() : '';
	const orderByDir = (orderBy && String(orderBy.dir || '').toLowerCase() === 'desc') ? 'DESC' : 'ASC';
	const distinct = !!(body && body.distinct === true);

	function ensureColumnAllowed(col) {
		if (!col) return false;
		return columnSet.has(col);
	}

	// SELECT list
	const selectParts = [];
	const groupByCols = groupBy.filter(ensureColumnAllowed);
	const hasGrouping = groupByCols.length > 0;

	if (hasGrouping) {
		for (const c of groupByCols) selectParts.push(`${quoteIdent(c)}`);
	} else {
		const wanted = columns.length ? columns : ['*'];
		if (wanted.length === 1 && wanted[0] === '*') {
			selectParts.push('*');
		} else {
			for (const c of wanted) {
				if (!ensureColumnAllowed(c)) throw badRequest(`Coluna inválida: ${c}`, 'ADMIN_DATAEXPLORER_INVALID_COLUMN');
				selectParts.push(`${quoteIdent(c)}`);
			}
		}
	}

	// Aggregates
	const aggAliasToExpr = new Map();
	for (const a of aggregates) {
		const fn = normalizeString(a && a.fn).toLowerCase();
		const col = normalizeString(a && a.column);
		const alias = normalizeString(a && a.as) || 'agg';

		let expr = null;
		if (fn === 'count') {
			expr = 'COUNT(*)';
		} else if (fn === 'count_distinct') {
			if (!ensureColumnAllowed(col)) throw badRequest('Coluna inválida para COUNT(DISTINCT)', 'ADMIN_DATAEXPLORER_INVALID_AGG_COLUMN');
			expr = `COUNT(DISTINCT ${quoteIdent(col)})`;
		} else if (['sum', 'avg', 'min', 'max'].includes(fn)) {
			if (!ensureColumnAllowed(col)) throw badRequest('Coluna inválida para agregação', 'ADMIN_DATAEXPLORER_INVALID_AGG_COLUMN');
			expr = `${fn.toUpperCase()}(${quoteIdent(col)})`;
		} else {
			continue;
		}

		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) {
			throw badRequest('Alias inválido (use letras/números/_)', 'ADMIN_DATAEXPLORER_INVALID_ALIAS');
		}

		selectParts.push(`${expr} AS ${quoteIdent(alias)}`);
		aggAliasToExpr.set(alias, expr);
	}

	if (distinct && (hasGrouping || aggAliasToExpr.size > 0)) {
		throw badRequest('DISTINCT não pode ser usado com GROUP BY/Agregação', 'ADMIN_DATAEXPLORER_DISTINCT_INVALID');
	}

	// WHERE filters
	const bind = {};
	let bindIdx = 1;
	function addBind(value) {
		const key = `p${bindIdx++}`;
		bind[key] = value;
		return `$${key}`;
	}

	const whereParts = [];
	for (const f of filters) {
		const col = normalizeString(f && f.column);
		const op = normalizeString(f && f.op).toLowerCase();
		if (!ensureColumnAllowed(col)) throw badRequest(`Coluna inválida: ${col}`, 'ADMIN_DATAEXPLORER_INVALID_FILTER_COLUMN');
		const pgType = columnType.get(col) || 'text';

		if (op === 'is_null') {
			whereParts.push(`${quoteIdent(col)} IS NULL`);
			continue;
		}
		if (op === 'not_null') {
			whereParts.push(`${quoteIdent(col)} IS NOT NULL`);
			continue;
		}

		const value = f && Object.prototype.hasOwnProperty.call(f, 'value') ? f.value : null;

		if (op === 'in' || op === 'not_in') {
			const list = splitInList(value);
			if (!list.length) throw badRequest('IN/NOT IN requer lista (ex: a,b,c)', 'ADMIN_DATAEXPLORER_IN_EMPTY');
			const coerced = list.map(v => coerceScalar(pgType, v));
			if (coerced.some(v => Number.isNaN(v))) {
				throw badRequest('Valor inválido para o tipo da coluna (IN/NOT IN)', 'ADMIN_DATAEXPLORER_IN_BAD_VALUE');
			}
			const ph = addBind(coerced);
			const expr = `${quoteIdent(col)} = ANY(${ph}::${pgType}[])`;
			whereParts.push(op === 'not_in' ? `NOT (${expr})` : expr);
			continue;
		}

		if (op === 'between') {
			const parts = splitBetween(value);
			if (!parts) throw badRequest('BETWEEN requer formato a..b (ou a,b)', 'ADMIN_DATAEXPLORER_BETWEEN_BAD_FORMAT');
			const a = coerceScalar(pgType, parts[0]);
			const b = coerceScalar(pgType, parts[1]);
			if (Number.isNaN(a) || Number.isNaN(b)) {
				throw badRequest('Valor inválido para o tipo da coluna (BETWEEN)', 'ADMIN_DATAEXPLORER_BETWEEN_BAD_VALUE');
			}
			const phA = addBind(a);
			const phB = addBind(b);
			whereParts.push(`${quoteIdent(col)} BETWEEN ${phA}::${pgType} AND ${phB}::${pgType}`);
			continue;
		}

		const ph = addBind(value);
		if (['=', '!=', '<', '<=', '>', '>='].includes(op)) {
			whereParts.push(`${quoteIdent(col)} ${op} ${ph}`);
			continue;
		}
		if (op === 'like') {
			whereParts.push(`${quoteIdent(col)} LIKE ${ph}`);
			continue;
		}
		if (op === 'ilike') {
			whereParts.push(`${quoteIdent(col)} ILIKE ${ph}`);
			continue;
		}

		throw badRequest(`Operador inválido: ${op}`, 'ADMIN_DATAEXPLORER_INVALID_OPERATOR');
	}

	// HAVING
	const havingParts = [];
	for (const h of having) {
		const alias = normalizeString(h && h.alias);
		const op = normalizeString(h && h.op);
		if (!alias || !aggAliasToExpr.has(alias)) throw badRequest('HAVING inválido (alias desconhecido)', 'ADMIN_DATAEXPLORER_INVALID_HAVING');
		if (!['=', '!=', '>=', '<=', '>', '<'].includes(op)) throw badRequest('Operador HAVING inválido', 'ADMIN_DATAEXPLORER_INVALID_HAVING_OP');

		const ph = addBind(h && Object.prototype.hasOwnProperty.call(h, 'value') ? h.value : null);
		havingParts.push(`${aggAliasToExpr.get(alias)} ${op} ${ph}`);
	}

	let sql = `SELECT ${distinct ? 'DISTINCT ' : ''}${selectParts.join(', ')} FROM ${quoteIdent('public')}.${quoteIdent(table)}`;
	if (whereParts.length) sql += ` WHERE ${whereParts.join(' AND ')}`;
	if (hasGrouping) sql += ` GROUP BY ${groupByCols.map(c => quoteIdent(c)).join(', ')}`;
	if (havingParts.length) sql += ` HAVING ${havingParts.join(' AND ')}`;

	if (orderByCol) {
		const orderIsAgg = aggAliasToExpr.has(orderByCol);
		const orderIsCol = ensureColumnAllowed(orderByCol);
		if (!orderIsAgg && !orderIsCol) {
			throw badRequest('ORDER BY inválido', 'ADMIN_DATAEXPLORER_INVALID_ORDERBY');
		}
		sql += ` ORDER BY ${quoteIdent(orderByCol)} ${orderByDir}`;
	}

	// ask for one extra row to detect hasMore
	const limitPlus = Math.min(limit + 1, MAX_LIMIT + 1);
	sql += ` LIMIT ${limitPlus} OFFSET ${offset}`;

	return { table, limit, offset, sql, bind };
}

module.exports = {
	listTables,
	listColumns,
	query,
	preview,
};
