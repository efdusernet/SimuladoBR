const sequelize = require('../config/database');
const { logger } = require('../utils/logger');
const { badRequest, conflict, notFound, unauthorized, internalError } = require('../middleware/errors');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const path = require('path');

function logQuestionSubmission(entry){
	try {
		const logDir = path.join(__dirname, '..', 'logs');
		if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
		const payload = { ts: new Date().toISOString(), ...entry };
		fs.appendFileSync(path.join(logDir, 'question_submissions.log'), JSON.stringify(payload) + '\n');
	} catch(e){ logger.error('logQuestionSubmission error:', e); }
}

// Cache table columns so we can support legacy/mixed schemas (quoted vs unquoted column names)
const _tableColumnsCache = new Map();
function _quoteIdent(name){
	const s = String(name || '');
	if (/^[a-z_][a-z0-9_]*$/.test(s)) return s;
	return '"' + s.replace(/"/g, '""') + '"';
}
async function _getPublicTableColumns(tableName, transaction){
	const tname = String(tableName || '').toLowerCase();
	if (!tname) return new Set();
	const cached = _tableColumnsCache.get(tname);
	const now = Date.now();
	if (cached && cached.ts && (now - cached.ts) < 5 * 60 * 1000 && cached.cols) return cached.cols;
	const rows = await sequelize.query(
		`SELECT column_name
		   FROM information_schema.columns
		  WHERE table_schema = 'public' AND table_name = :tname`,
		{ replacements: { tname }, type: sequelize.QueryTypes.SELECT, transaction }
	);
	const cols = new Set((rows || []).map(r => r && r.column_name).filter(Boolean));
	_tableColumnsCache.set(tname, { ts: now, cols });
	return cols;
}
function _pickColumn(colsSet, candidates){
	for (const c of (candidates || [])) {
		if (colsSet && colsSet.has(c)) return c;
	}
	return null;
}

exports.createQuestion = async (req, res, next) => {
	try {
		const b = req.body || {};
		const descricao = (b.descricao || '').trim();
		if (!descricao) return next(badRequest('descricao required', 'DESCRICAO_REQUIRED'));
		// seed is mandatory
		let seed = null;
		if (typeof b.seed === 'boolean') seed = b.seed;
		else if (typeof b.seed === 'string') {
			const s = b.seed.trim().toLowerCase();
			if (s === 'true' || s === '1') seed = true;
			if (s === 'false' || s === '0') seed = false;
		} else if (typeof b.seed === 'number') {
			if (b.seed === 1) seed = true;
			if (b.seed === 0) seed = false;
		}
		if (seed == null) return next(badRequest('seed required', 'SEED_REQUIRED'));
		// Decide tipo e multiplaescolha
		const tiposlug = (b.tiposlug || '').trim().toLowerCase() || null;
		let multipla = null;
		if (typeof b.multiplaescolha === 'boolean') multipla = b.multiplaescolha;
		if (multipla == null && tiposlug) {
			if (['multi','multiple','checkbox'].includes(tiposlug)) multipla = true; else if (['single','radio'].includes(tiposlug)) multipla = false;
		}
		if (multipla == null) multipla = false;
		// Audit: usuário criador para respostaopcao (criadousuario / alteradousuario)
		const createdByUserId = Number.isFinite(Number(b.createdByUserId)) ? Number(b.createdByUserId) : null;
	const iddominio = Number.isFinite(Number(b.iddominio)) ? Number(b.iddominio) : 1;
	const codareaconhecimento = (b.codareaconhecimento != null && b.codareaconhecimento !== '') ? Number(b.codareaconhecimento) : null;
	const codgrupoprocesso = (b.codgrupoprocesso != null && b.codgrupoprocesso !== '') ? Number(b.codgrupoprocesso) : null;
	const iddominiogeral = (b.iddominiogeral != null && b.iddominiogeral !== '') ? Number(b.iddominiogeral) : null;
	const idprincipio = (b.idprincipio != null && b.idprincipio !== '') ? Number(b.idprincipio) : null;
	const codigocategoria = (b.codigocategoria != null && b.codigocategoria !== '') ? Number(b.codigocategoria) : null;
	const codniveldificuldade = (b.codniveldificuldade != null && b.codniveldificuldade !== '') ? Number(b.codniveldificuldade) : null;
	const id_task = (b.id_task != null && b.id_task !== '') ? Number(b.id_task) : null;
	const dica = (b.dica || null);
	const imagemUrl = (b.imagemUrl || b.imagem_url || '').trim() || null;
	const versaoExame = (b.versao_exame || b.versaoExame || '').trim() || null;
	// Legacy: previously a single explanation per question. Now we store per-option.
	// If provided, we use it as a fallback for the correct option.
	const explicacao = (b.explicacao != null) ? String(b.explicacao).trim() : null;
		const options = Array.isArray(b.options) ? b.options : [];
		// exam type: accept id or slug
		const examTypeId = Number.isFinite(Number(b.examTypeId)) ? Number(b.examTypeId) : null;
		const examTypeSlug = (b.examTypeSlug || b.examType || '').trim().toLowerCase() || null;
		let resolvedExamTypeId = examTypeId || null;

			if (!resolvedExamTypeId && examTypeSlug) {
			try {
				const row = await sequelize.query('SELECT id FROM public.exam_type WHERE slug = :slug AND (ativo = TRUE OR ativo IS NULL) LIMIT 1', { replacements: { slug: examTypeSlug }, type: sequelize.QueryTypes.SELECT });
				if (row && row[0] && row[0].id != null) resolvedExamTypeId = Number(row[0].id);
			} catch(_) { /* ignore */ }
		}
			if (!resolvedExamTypeId) return next(badRequest('examType required', 'EXAM_TYPE_REQUIRED'));

		// Validate createdByUserId antes de iniciar transação (evita falha tardia na FK)
		if (!Number.isFinite(createdByUserId) || createdByUserId <= 0) {
			return next(badRequest('createdByUserId required', 'CREATED_BY_REQUIRED'));
		}
		try {
			const urow = await sequelize.query('SELECT "Id" FROM public."Usuario" WHERE "Id" = :uid LIMIT 1', { replacements: { uid: createdByUserId }, type: sequelize.QueryTypes.SELECT });
			if (!urow || !urow[0] || urow[0].Id == null) {
				return next(badRequest('createdByUserId not found', 'CREATED_BY_NOT_FOUND'));
			}
		} catch(e){ return next(internalError('user lookup failed', 'USER_LOOKUP_FAILED', e)); }

		// Duplicate check (case-insensitive, trimmed) scoped to exam_type_id, ignoring excluidos
		try {
			const dupRows = await sequelize.query(
				'SELECT id FROM public.questao WHERE exam_type_id = :examTypeId AND LOWER(TRIM(descricao)) = LOWER(TRIM(:descricao)) AND (excluido = FALSE OR excluido IS NULL) LIMIT 1',
				{ replacements: { examTypeId: resolvedExamTypeId, descricao }, type: sequelize.QueryTypes.SELECT }
			);
			if (dupRows && dupRows[0] && dupRows[0].id != null) {
				const dupId = Number(dupRows[0].id);
				logQuestionSubmission({ route: 'createQuestion:duplicate', descricao, examTypeId: resolvedExamTypeId, existingId: dupId });
				return next(conflict('duplicate', 'QUESTION_DUPLICATE', { id: dupId }));
			}
		} catch(_){ /* silent duplicate lookup failure */ }
		let createdId = null;
		await sequelize.transaction(async (t) => {
		// Insert question
		const insertQ = `INSERT INTO public.questao (
			iddominio, idstatus, descricao, datacadastro, dataalteracao,
			criadousuario, alteradousuario, excluido, seed, nivel,
			idprincipio, dica, multiplaescolha, codigocategoria, codgrupoprocesso, tiposlug, exam_type_id, iddominiogeral, imagem_url, codniveldificuldade, id_task, versao_exame
		) VALUES (
			:iddominio, 1, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
			:createdByUserId, :createdByUserId, false, :seed, 1,
			:idprincipio, :dica, :multipla, :codigocategoria, :codgrupoprocesso, :tiposlug, :exam_type_id, :iddominiogeral, :imagem_url, :codniveldificuldade, :id_task, :versao_exame
		) RETURNING id`;
		const r = await sequelize.query(insertQ, { replacements: { iddominio, descricao, dica, multipla, seed, codgrupoprocesso, codigocategoria, tiposlug: tiposlug || (multipla ? 'multi' : 'single'), exam_type_id: resolvedExamTypeId, iddominiogeral, idprincipio, imagem_url: imagemUrl, codniveldificuldade, id_task, versao_exame: versaoExame, createdByUserId }, type: sequelize.QueryTypes.INSERT, transaction: t });
			// Sequelize returns [result, metadata]; get id via second element row if needed
			// Safer: fetch with SELECT currval... but RETURNING should give us id in r[0][0].id depending on dialect
			const insertedRow = Array.isArray(r) && r[0] && Array.isArray(r[0]) ? r[0][0] : null;
			createdId = insertedRow && insertedRow.id ? Number(insertedRow.id) : null;
			if (!createdId) {
				// fallback: select last inserted by descricao + timestamp (unlikely needed)
				const check = await sequelize.query('SELECT id FROM public.questao WHERE descricao = :descricao ORDER BY id DESC LIMIT 1', { replacements: { descricao }, type: sequelize.QueryTypes.SELECT, transaction: t });
				createdId = (check && check[0] && check[0].id) ? Number(check[0].id) : null;
			}
			if (!createdId) throw new Error('Could not retrieve created question id');
			// Inserir opções com auditoria (sem swallow de erro)
			const incomingOpts = Array.isArray(options) ? options : [];
			let normalized = incomingOpts
				.filter(o => o && typeof o.descricao === 'string' && o.descricao.trim() !== '')
				.map(o => ({
					descricao: o.descricao.trim(),
					correta: !!o.correta,
					explicacao: (o.explicacao != null) ? String(o.explicacao).trim() : ''
				}));
			if (normalized.length >= 2) {
				if (!multipla) {
					let seen = false;
					normalized.forEach(o => { if (o.correta) { if (!seen) { seen = true; } else { o.correta = false; } } });
				}
				let correctOptIndex = -1;
				normalized.forEach((o, idx) => { if (o.correta && correctOptIndex === -1) correctOptIndex = idx; });
				if (correctOptIndex >= 0 && (!normalized[correctOptIndex].explicacao || !normalized[correctOptIndex].explicacao.trim()) && explicacao) {
					normalized[correctOptIndex].explicacao = explicacao;
				}
				for (const opt of normalized) {
					const ins = await sequelize.query(
						'INSERT INTO public.respostaopcao (idquestao, descricao, iscorreta, excluido, criadousuario, alteradousuario, datacadastro, dataalteracao) VALUES (:qid,:descricao,:correta,false,:uid,:uid,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id',
						{ replacements: { qid: createdId, descricao: opt.descricao, correta: opt.correta, uid: createdByUserId }, type: sequelize.QueryTypes.INSERT, transaction: t }
					);
					const insertedOptRow = Array.isArray(ins) && ins[0] && Array.isArray(ins[0]) ? ins[0][0] : null;
					const optId = insertedOptRow && insertedOptRow.id != null ? Number(insertedOptRow.id) : null;
					if (!optId) throw new Error('Could not retrieve created option id');

					// Ensure one explanation row per option (descricao is NOT NULL; allow empty string).
					await sequelize.query(
						`INSERT INTO public.explicacaoguia (idquestao, idrespostaopcao, descricao, datacadastro, dataalteracao, excluido, criadousuario, alteradousuario)
						 VALUES (:qid, :oid, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, false, :uid, :uid)`,
						{ replacements: { qid: createdId, oid: optId, descricao: opt.explicacao || '', uid: createdByUserId }, type: sequelize.QueryTypes.INSERT, transaction: t }
					);
				}
			}
			// Note: legacy question-level explicacao is now handled as a fallback for the correct option.
		});

		return res.status(201).json({ id: createdId });
	} catch (err) {
		logger.error('createQuestion error:', err);
		return next(internalError('Internal error', 'CREATE_QUESTION_ERROR', err));
	}
};

// List questions (IDs) with pagination and ordering
exports.listQuestions = async (req, res, next) => {
	try {
		const page = Math.max(1, parseInt(req.query.page || '1', 10));
		const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
		const order = String(req.query.order || 'created_at desc').toLowerCase();

		let orderBy = 'q.datacadastro DESC';
		if (order.includes('created_at') && order.includes('asc')) orderBy = 'q.datacadastro ASC';
		else if (order.includes('created_at') && order.includes('desc')) orderBy = 'q.datacadastro DESC';
		else if (order.includes('id') && order.includes('asc')) orderBy = 'q.id ASC';
		else if (order.includes('id') && order.includes('desc')) orderBy = 'q.id DESC';

		const where = ['(q.excluido = FALSE OR q.excluido IS NULL)'];
		const params = {};

		// Optional filter: examType (slug or id)
		if (req.query.examType) {
			const et = String(req.query.examType).trim();
			if (/^\d+$/.test(et)) { where.push('q.exam_type_id = :examTypeId'); params.examTypeId = Number(et); }
			else { where.push('et.slug = :examTypeSlug'); params.examTypeSlug = et.toLowerCase(); }
		}

		const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
		const offset = (page - 1) * pageSize;

		const sql = `SELECT q.id
								 FROM public.questao q
								 LEFT JOIN public.exam_type et ON et.id = q.exam_type_id
								 ${whereSql}
								 ORDER BY ${orderBy}
								 LIMIT :limit OFFSET :offset`;
		const countSql = `SELECT COUNT(*)::int AS c
											FROM public.questao q
											LEFT JOIN public.exam_type et ON et.id = q.exam_type_id
											${whereSql}`;
		const rows = await sequelize.query(sql, { replacements: { ...params, limit: pageSize, offset }, type: sequelize.QueryTypes.SELECT });
		const totResult = await sequelize.query(countSql, { replacements: params, type: sequelize.QueryTypes.SELECT });
		const items = (rows || []).map(r => r.id);
		const total = (totResult && totResult[0] && totResult[0].c != null) ? Number(totResult[0].c) : 0;
		return res.json({ items, total, page, pageSize });
	} catch (e) {
		logger.error('listQuestions error:', e);
		return next(internalError('internal error', 'LIST_QUESTIONS_ERROR', e));
	}
};

// Get single question with options and explanation
exports.getQuestionById = async (req, res, next) => {
	try {
		const id = Number(req.params.id);
		if (!Number.isFinite(id)) return next(badRequest('invalid id', 'INVALID_ID'));

	const qsql = `SELECT q.id, q.descricao, q.tiposlug, q.iddominio, NULL AS codareaconhecimento, q.codgrupoprocesso, q.iddominiogeral, q.idprincipio, q.codigocategoria,
						 q.seed,
												 q.dica, q.imagem_url, q.multiplaescolha, q.codniveldificuldade, q.id_task, q.exam_type_id,
												 q.versao_exame,
												 et.slug AS exam_type_slug, et.nome AS exam_type_nome
								FROM public.questao q
								LEFT JOIN public.exam_type et ON et.id = q.exam_type_id
								WHERE q.id = :id`;
		const row = await sequelize.query(qsql, { replacements: { id }, type: sequelize.QueryTypes.SELECT });
		if (!row || !row[0]) return next(notFound('not found', 'QUESTION_NOT_FOUND'));
		const base = row[0];

		const osql = `SELECT ro.id, ro.descricao, ro.iscorreta AS correta,
							eg.descricao AS explicacao
						FROM public.respostaopcao ro
						LEFT JOIN public.explicacaoguia eg
							ON eg.idrespostaopcao = ro.id AND (eg.excluido = FALSE OR eg.excluido IS NULL)
						WHERE ro.idquestao = :id AND (ro.excluido = FALSE OR ro.excluido IS NULL)
						ORDER BY ro.id`;
		const opts = await sequelize.query(osql, { replacements: { id }, type: sequelize.QueryTypes.SELECT });

		let explicacao = null;
		// Backward-compat: keep question.explicacao using either legacy general row (idrespostaopcao IS NULL)
		// or the correct option explanation.
		try {
			const esql = `SELECT descricao FROM public.explicacaoguia
						WHERE idquestao = :id AND idrespostaopcao IS NULL AND (excluido = FALSE OR excluido IS NULL)
						ORDER BY dataalteracao DESC LIMIT 1`;
			const erow = await sequelize.query(esql, { replacements: { id }, type: sequelize.QueryTypes.SELECT });
			if (erow && erow[0] && erow[0].descricao != null) explicacao = String(erow[0].descricao);
		} catch(_) {}
		if (!explicacao && Array.isArray(opts)) {
			const correct = opts.find(o => o && o.correta);
			if (correct && correct.explicacao != null) explicacao = String(correct.explicacao);
		}

		return res.json({
			id: base.id,
			descricao: base.descricao,
			tiposlug: base.tiposlug,
			seed: base.seed === true || base.seed === 't',
			iddominio: base.iddominio,
			codareaconhecimento: base.codareaconhecimento,
			codgrupoprocesso: base.codgrupoprocesso,
			iddominiogeral: base.iddominiogeral,
			idprincipio: base.idprincipio,
			codigocategoria: base.codigocategoria,
			codniveldificuldade: base.codniveldificuldade,
			id_task: base.id_task,
			dica: base.dica,
			imagemUrl: base.imagem_url,
			versao_exame: base.versao_exame,
			explicacao,
			options: opts || [],
			examType: { id: base.exam_type_id, slug: base.exam_type_slug, nome: base.exam_type_nome }
		});
	} catch (e) {
		logger.error('getQuestionById error:', e);
		return next(internalError('internal error', 'GET_QUESTION_ERROR', e));
	}
};

// Update a question and replace options/explicacao
exports.updateQuestion = async (req, res, next) => {
	try {
		const id = Number(req.params.id);
		if (!Number.isFinite(id)) return next(badRequest('invalid id', 'INVALID_ID'));
		const b = req.body || {};
		logQuestionSubmission({ route: 'updateQuestion:start', id, body: b });

		const descricao = (b.descricao || '').trim();
		if (!descricao) return next(badRequest('descricao required', 'DESCRICAO_REQUIRED'));
		// seed is mandatory
		let seed = null;
		if (typeof b.seed === 'boolean') seed = b.seed;
		else if (typeof b.seed === 'string') {
			const s = b.seed.trim().toLowerCase();
			if (s === 'true' || s === '1') seed = true;
			if (s === 'false' || s === '0') seed = false;
		} else if (typeof b.seed === 'number') {
			if (b.seed === 1) seed = true;
			if (b.seed === 0) seed = false;
		}
		if (seed == null) return next(badRequest('seed required', 'SEED_REQUIRED'));
		const tiposlug = (b.tiposlug || '').trim().toLowerCase() || null;
		let multipla = null;
		if (typeof b.multiplaescolha === 'boolean') multipla = b.multiplaescolha;
		if (multipla == null && tiposlug) {
			if (['multi','multiple','checkbox'].includes(tiposlug)) multipla = true; else if (['single','radio'].includes(tiposlug)) multipla = false;
		}
		if (multipla == null) multipla = false;
		const iddominio = (b.iddominio != null && b.iddominio !== '') ? Number(b.iddominio) : null;
		const codareaconhecimento = (b.codareaconhecimento != null && b.codareaconhecimento !== '') ? Number(b.codareaconhecimento) : null;
		const codgrupoprocesso = (b.codgrupoprocesso != null && b.codgrupoprocesso !== '') ? Number(b.codgrupoprocesso) : null;
		const iddominiogeral = (b.iddominiogeral != null && b.iddominiogeral !== '') ? Number(b.iddominiogeral) : null;
		const idprincipio = (b.idprincipio != null && b.idprincipio !== '') ? Number(b.idprincipio) : null;
	const codigocategoria = (b.codigocategoria != null && b.codigocategoria !== '') ? Number(b.codigocategoria) : null;
	const codniveldificuldade = (b.codniveldificuldade != null && b.codniveldificuldade !== '') ? Number(b.codniveldificuldade) : null;
	const id_task = (b.id_task != null && b.id_task !== '') ? Number(b.id_task) : null;
	const dica = (b.dica || null);
	const imagemUrl = (b.imagemUrl || b.imagem_url || '').trim() || null;
	const versaoExame = (b.versao_exame || b.versaoExame || '').trim() || null;
		// Legacy: question-level explanation. We treat it as a fallback for the correct option.
		const explicacao = (b.explicacao != null) ? String(b.explicacao) : null;
		// Audit: updatedByUserId for respostaopcao on update
		const updatedByUserId = Number.isFinite(Number(b.updatedByUserId)) ? Number(b.updatedByUserId) : null;
		// Validate updatedByUserId (must exist in Usuario)
		if (!Number.isFinite(updatedByUserId) || updatedByUserId <= 0) {
			return next(badRequest('updatedByUserId required', 'UPDATED_BY_REQUIRED'));
		}
		try {
			const urow = await sequelize.query('SELECT "Id" FROM public."Usuario" WHERE "Id" = :uid LIMIT 1', { replacements: { uid: updatedByUserId }, type: sequelize.QueryTypes.SELECT });
			if (!urow || !urow[0] || urow[0].Id == null) {
				return next(badRequest('updatedByUserId not found', 'UPDATED_BY_NOT_FOUND'));
			}
		} catch(e){ return next(internalError('user lookup failed', 'USER_LOOKUP_FAILED', e)); }
		const examTypeId = Number.isFinite(Number(b.examTypeId)) ? Number(b.examTypeId) : null;
		const examTypeSlug = (b.examTypeSlug || b.examType || '').trim().toLowerCase() || null;
		let resolvedExamTypeId = examTypeId || null;
		if (!resolvedExamTypeId && examTypeSlug) {
			try {
				const row = await sequelize.query('SELECT id FROM public.exam_type WHERE slug = :slug AND (ativo = TRUE OR ativo IS NULL) LIMIT 1', { replacements: { slug: examTypeSlug }, type: sequelize.QueryTypes.SELECT });
				if (row && row[0] && row[0].id != null) resolvedExamTypeId = Number(row[0].id);
			} catch(_) { /* ignore */ }
		}

		await sequelize.transaction(async (t) => {
			const upQ = `UPDATE public.questao SET
				descricao = :descricao,
				tiposlug = :tiposlug,
				multiplaescolha = :multipla,
				seed = :seed,
				iddominio = :iddominio,
				codgrupoprocesso = :codgrupoprocesso,
				iddominiogeral = :iddominiogeral,
				idprincipio = :idprincipio,
				codigocategoria = :codigocategoria,
				dica = :dica,
				imagem_url = :imagem_url,
				codniveldificuldade = :codniveldificuldade,
				id_task = :id_task,
				versao_exame = :versao_exame,
				exam_type_id = COALESCE(:exam_type_id, exam_type_id),
				alteradousuario = :updatedByUserId,
				dataalteracao = CURRENT_TIMESTAMP
			WHERE id = :id`;
			await sequelize.query(upQ, { replacements: { id, descricao, tiposlug: tiposlug || (multipla ? 'multi' : 'single'), multipla, seed, iddominio, codgrupoprocesso, iddominiogeral, idprincipio, codigocategoria, dica, imagem_url: imagemUrl, codniveldificuldade, id_task, versao_exame: versaoExame, exam_type_id: resolvedExamTypeId, updatedByUserId }, type: sequelize.QueryTypes.UPDATE, transaction: t });

			// Navegação: atualizar/inserir opções sem checagem dinâmica de colunas
			try {
				const incomingOpts = Array.isArray(b.options) ? b.options : [];
				let normalized = incomingOpts
					.filter(o => o && typeof o.descricao === 'string' && o.descricao.trim() !== '')
					.map(o => ({
						descricao: o.descricao.trim(),
						correta: !!o.correta,
						explicacao: (o.explicacao != null) ? String(o.explicacao).trim() : ''
					}));
				if (normalized.length >= 2) {
					if (!multipla) {
						let seen = false;
						normalized.forEach(o => { if (o.correta) { if (!seen) { seen = true; } else { o.correta = false; } } });
					}
					let correctOptIndex = -1;
					normalized.forEach((o, idx) => { if (o.correta && correctOptIndex === -1) correctOptIndex = idx; });
					if (correctOptIndex >= 0 && (!normalized[correctOptIndex].explicacao || !normalized[correctOptIndex].explicacao.trim()) && explicacao) {
						normalized[correctOptIndex].explicacao = String(explicacao).trim();
					}

					const existing = await sequelize.query(
						'SELECT id FROM public.respostaopcao WHERE idquestao = :qid AND (excluido = FALSE OR excluido IS NULL) ORDER BY id',
						{ replacements: { qid: id }, type: sequelize.QueryTypes.SELECT, transaction: t }
					);
					const existingIds = existing.map(r => Number(r.id)).filter(Number.isFinite);
					const finalOptionIds = [];
					for (let i = 0; i < normalized.length; i++) {
						const opt = normalized[i];
						if (i < existingIds.length) {
							const optId = existingIds[i];
							await sequelize.query(
								'UPDATE public.respostaopcao SET descricao = :descricao, iscorreta = :correta, alteradousuario = :updatedByUserId, dataalteracao = CURRENT_TIMESTAMP WHERE id = :id',
								{ replacements: { descricao: opt.descricao, correta: opt.correta, id: optId, updatedByUserId }, type: sequelize.QueryTypes.UPDATE, transaction: t }
							);
							finalOptionIds.push(optId);
						} else {
							const ins = await sequelize.query(
								'INSERT INTO public.respostaopcao (idquestao, descricao, iscorreta, excluido, criadousuario, alteradousuario, datacadastro, dataalteracao) VALUES (:qid,:descricao,:correta,false,:createdByUserId,:createdByUserId,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id',
								{ replacements: { qid: id, descricao: opt.descricao, correta: opt.correta, createdByUserId: updatedByUserId }, type: sequelize.QueryTypes.INSERT, transaction: t }
							);
							const insertedOptRow = Array.isArray(ins) && ins[0] && Array.isArray(ins[0]) ? ins[0][0] : null;
							const optId = insertedOptRow && insertedOptRow.id != null ? Number(insertedOptRow.id) : null;
							if (!optId) throw new Error('Could not retrieve inserted option id');
							finalOptionIds.push(optId);
						}
					}
					if (existingIds.length > normalized.length) {
						const toRemove = existingIds.slice(normalized.length);
						await sequelize.query(
							'UPDATE public.respostaopcao SET excluido = TRUE, dataalteracao = CURRENT_TIMESTAMP WHERE id = ANY(:ids)',
							{ replacements: { ids: toRemove }, type: sequelize.QueryTypes.UPDATE, transaction: t }
						);
						// Also mark linked explanations as excluded
						try {
							await sequelize.query(
								'UPDATE public.explicacaoguia SET excluido = TRUE, dataalteracao = CURRENT_TIMESTAMP WHERE idrespostaopcao = ANY(:ids)',
								{ replacements: { ids: toRemove }, type: sequelize.QueryTypes.UPDATE, transaction: t }
							);
						} catch(_) { /* ignore */ }
					}

					// Upsert explanations per option (one row per option)
					for (let i = 0; i < finalOptionIds.length; i++) {
						const optId = finalOptionIds[i];
						const expText = (normalized[i] && normalized[i].explicacao != null) ? String(normalized[i].explicacao).trim() : '';
						const existingExp = await sequelize.query(
							'SELECT id FROM public.explicacaoguia WHERE idquestao = :qid AND idrespostaopcao = :oid LIMIT 1',
							{ replacements: { qid: id, oid: optId }, type: sequelize.QueryTypes.SELECT, transaction: t }
						);
						if (existingExp && existingExp[0] && existingExp[0].id != null) {
							await sequelize.query(
								'UPDATE public.explicacaoguia SET descricao = :descricao, dataalteracao = CURRENT_TIMESTAMP, alteradousuario = :uid, excluido = FALSE WHERE id = :eid',
								{ replacements: { descricao: expText || '', uid: updatedByUserId, eid: Number(existingExp[0].id) }, type: sequelize.QueryTypes.UPDATE, transaction: t }
							);
						} else {
							await sequelize.query(
								`INSERT INTO public.explicacaoguia (idquestao, idrespostaopcao, descricao, datacadastro, dataalteracao, excluido, criadousuario, alteradousuario)
								 VALUES (:qid, :oid, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, false, :uid, :uid)`,
								{ replacements: { qid: id, oid: optId, descricao: expText || '', uid: updatedByUserId }, type: sequelize.QueryTypes.INSERT, transaction: t }
							);
						}
					}
				}
			} catch(_){ /* ignora erros de opções */ }

			// Note: legacy question-level explicacao is now treated as a fallback for the correct option.
		});

		logQuestionSubmission({ route: 'updateQuestion:done', id, descricao, optionsCount: Array.isArray(b.options) ? b.options.length : 0 });
		return res.json({ ok: true, id });
	} catch (e) {
		logger.error('updateQuestion error:', e);
		logQuestionSubmission({ route: 'updateQuestion:error', id: Number(req.params.id), error: e && e.message });
		return next(internalError('internal error', 'UPDATE_QUESTION_ERROR', e));
	}
};

exports.deleteQuestion = async (req, res, next) => {
	try {
		const id = Number(req.params.id);
		if (!Number.isFinite(id) || id <= 0) return next(badRequest('invalid id', 'INVALID_ID'));
		const userId = req.user && (req.user.Id || req.user.id) ? Number(req.user.Id || req.user.id) : null;
		if (!Number.isFinite(userId) || userId <= 0) return next(unauthorized('unauthorized', 'UNAUTHORIZED'));

		let result = { ok: true, id, hardDeleted: true, deleted: { explicacaoguia: 0, respostaopcao: 0, questao: 0 } };
		await sequelize.transaction(async (t) => {
			// Lock row to avoid concurrent edits
			const row = await sequelize.query(
				'SELECT id, excluido FROM public.questao WHERE id = :id FOR UPDATE',
				{ replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
			);
			if (!row || !row[0] || row[0].id == null) {
				throw notFound('not found', 'QUESTION_NOT_FOUND');
			}

			// Hard-delete in FK-safe order: explicacaoguia -> respostaopcao -> questao
			// NOTE: some deployments don't have explicacaoguia.idquestao (legacy schema),
			// so delete by linked option ids (idrespostaopcao) instead.
			const delEg = await sequelize.query(
				`DELETE FROM public.explicacaoguia
				 WHERE idrespostaopcao IN (
					SELECT id FROM public.respostaopcao WHERE idquestao = :id
				 )`,
				{ replacements: { id }, transaction: t }
			);
			result.deleted.explicacaoguia = Array.isArray(delEg) ? (delEg[1] && typeof delEg[1].rowCount === 'number' ? delEg[1].rowCount : (typeof delEg[1] === 'number' ? delEg[1] : 0)) : 0;

			const delRo = await sequelize.query(
				'DELETE FROM public.respostaopcao WHERE idquestao = :id',
				{ replacements: { id }, transaction: t }
			);
			result.deleted.respostaopcao = Array.isArray(delRo) ? (delRo[1] && typeof delRo[1].rowCount === 'number' ? delRo[1].rowCount : (typeof delRo[1] === 'number' ? delRo[1] : 0)) : 0;

			const delQ = await sequelize.query(
				'DELETE FROM public.questao WHERE id = :id',
				{ replacements: { id }, transaction: t }
			);
			result.deleted.questao = Array.isArray(delQ) ? (delQ[1] && typeof delQ[1].rowCount === 'number' ? delQ[1].rowCount : (typeof delQ[1] === 'number' ? delQ[1] : 0)) : 0;
		});

		return res.json(result);
	} catch (err) {
		// Allow our internal notFound(...) error object to pass through
		if (err && err.status && err.code) return next(err);
		// FK constraint violations or similar should surface as a conflict for the UI
		const code = (err && err.original && err.original.code) || err.code || '';
		const msg = (err && (err.message || err.toString())) || '';
		if (code === '23503' || /violates foreign key constraint/i.test(msg)) {
			return next(conflict('cannot delete due to related records', 'QUESTION_DELETE_CONFLICT', { id }));
		}
		logger.error('deleteQuestion error:', err);
		return next(internalError('Internal error', 'DELETE_QUESTION_ERROR', err));
	}
};

// Save/update explicacao for a single option (respostaopcao)
// PUT /api/questions/options/:optionId/explanation
// Body: { descricao: string }
exports.saveOptionExplanation = async (req, res, next) => {
	try {
		const optionId = Number(req.params.optionId);
		if (!Number.isFinite(optionId) || optionId <= 0) return next(badRequest('invalid optionId', 'INVALID_OPTION_ID'));
		const userId = req.user && (req.user.Id || req.user.id) ? Number(req.user.Id || req.user.id) : null;
		if (!Number.isFinite(userId) || userId <= 0) return next(unauthorized('unauthorized', 'UNAUTHORIZED'));

		const body = req.body || {};
		const descricao = (body.descricao != null) ? String(body.descricao) : '';

		const result = { ok: true, optionId, created: false, updated: false };
		await sequelize.transaction(async (t) => {
			// Ensure option exists (and capture question id if needed)
			const optRows = await sequelize.query(
				'SELECT id, idquestao FROM public.respostaopcao WHERE id = :oid LIMIT 1',
				{ replacements: { oid: optionId }, type: sequelize.QueryTypes.SELECT, transaction: t }
			);
			if (!optRows || !optRows[0] || optRows[0].id == null) throw notFound('option not found', 'OPTION_NOT_FOUND');
			const optionQuestionId = (optRows[0].idquestao != null) ? Number(optRows[0].idquestao) : null;

			const cols = await _getPublicTableColumns('explicacaoguia', t);
			const colOptionId = _pickColumn(cols, ['idrespostaopcao', 'IdRespostaOpcao']);
			const colDescricao = _pickColumn(cols, ['descricao', 'Descricao']);
			const colId = _pickColumn(cols, ['id', 'Id']);
			const colExcluido = _pickColumn(cols, ['excluido', 'Excluido']);
			const colDataCadastro = _pickColumn(cols, ['datacadastro', 'DataCadastro']);
			const colDataAlteracao = _pickColumn(cols, ['dataalteracao', 'DataAlteracao']);
			const colCriadoUsuario = _pickColumn(cols, ['criadousuario', 'CriadoUsuario', 'CriadoUsuarioId']);
			const colAlteradoUsuario = _pickColumn(cols, ['alteradousuario', 'AlteradoUsuario', 'AlteradoUsuarioId']);
			const colQuestao = _pickColumn(cols, ['idquestao', 'IdQuestao']);

			if (!colOptionId || !colDescricao) {
				throw internalError('explicacaoguia schema missing required columns', 'EXPLICACAOGUIA_SCHEMA_MISSING', { missing: { idrespostaopcao: !colOptionId, descricao: !colDescricao } });
			}

			// Find existing row by option id (prefer the most recent)
			let existing = null;
			if (colId) {
				const orderBy = [];
				if (colDataAlteracao) orderBy.push(`${_quoteIdent(colDataAlteracao)} DESC`);
				orderBy.push(`${_quoteIdent(colId)} DESC`);
				const selSql = `SELECT ${_quoteIdent(colId)} AS id${colExcluido ? `, ${_quoteIdent(colExcluido)} AS excluido` : ''}
					FROM public.explicacaoguia
					WHERE ${_quoteIdent(colOptionId)} = :oid
					ORDER BY ${orderBy.join(', ')}
					LIMIT 1`;
				const rows = await sequelize.query(selSql, { replacements: { oid: optionId }, type: sequelize.QueryTypes.SELECT, transaction: t });
				if (rows && rows[0] && rows[0].id != null) existing = rows[0];
			}

			if (existing && existing.id != null) {
				const setParts = [`${_quoteIdent(colDescricao)} = :descricao`];
				if (colDataAlteracao) setParts.push(`${_quoteIdent(colDataAlteracao)} = CURRENT_TIMESTAMP`);
				if (colAlteradoUsuario) setParts.push(`${_quoteIdent(colAlteradoUsuario)} = :uid`);
				if (colExcluido) setParts.push(`${_quoteIdent(colExcluido)} = FALSE`);
				const updSql = `UPDATE public.explicacaoguia SET ${setParts.join(', ')} WHERE ${_quoteIdent(colId)} = :eid`;
				await sequelize.query(updSql, { replacements: { descricao, uid: userId, eid: Number(existing.id) }, transaction: t });
				result.updated = true;
			} else {
				const colsIns = [colOptionId, colDescricao];
				const valsIns = [':oid', ':descricao'];
				const repl = { oid: optionId, descricao, uid: userId, qid: optionQuestionId };

				if (colQuestao && Number.isFinite(optionQuestionId)) { colsIns.push(colQuestao); valsIns.push(':qid'); }
				if (colExcluido) { colsIns.push(colExcluido); valsIns.push('FALSE'); }
				if (colDataCadastro) { colsIns.push(colDataCadastro); valsIns.push('CURRENT_TIMESTAMP'); }
				if (colDataAlteracao) { colsIns.push(colDataAlteracao); valsIns.push('CURRENT_TIMESTAMP'); }
				if (colCriadoUsuario) { colsIns.push(colCriadoUsuario); valsIns.push(':uid'); }
				if (colAlteradoUsuario) { colsIns.push(colAlteradoUsuario); valsIns.push(':uid'); }

				const insSql = `INSERT INTO public.explicacaoguia (${colsIns.map(_quoteIdent).join(', ')}) VALUES (${valsIns.join(', ')})`;
				await sequelize.query(insSql, { replacements: repl, transaction: t });
				result.created = true;
			}
		});

		return res.json(result);
	} catch (err) {
		if (err && err.status && err.code) return next(err);
		logger.error('saveOptionExplanation error:', err);
		return next(internalError('Internal error', 'SAVE_OPTION_EXPLANATION_ERROR', err));
	}
};

// Check if a question exists by exact descricao (case-insensitive, trimmed) and exam type (id or slug)
exports.existsQuestion = async (req, res, next) => {
	try {
		const rawDesc = (req.query.descricao || '').trim();
		if (!rawDesc) return next(badRequest('descricao required', 'DESCRICAO_REQUIRED'));
		const examTypeRaw = (req.query.examType || '').trim();
		if (!examTypeRaw) return next(badRequest('examType required', 'EXAM_TYPE_REQUIRED'));
		logQuestionSubmission({ route: 'existsQuestion:start', descricao: rawDesc, examType: examTypeRaw });
		let examTypeId = null;
		if (/^\d+$/.test(examTypeRaw)) {
			examTypeId = Number(examTypeRaw);
		} else {
			const row = await sequelize.query('SELECT id FROM public.exam_type WHERE slug = :slug AND (ativo = TRUE OR ativo IS NULL) LIMIT 1', { replacements: { slug: examTypeRaw.toLowerCase() }, type: sequelize.QueryTypes.SELECT });
			if (row && row[0] && row[0].id != null) examTypeId = Number(row[0].id);
		}
		if (!examTypeId) {
			// Em vez de 400, retornar 200 com exists:false para evitar ruído no frontend
			logQuestionSubmission({ route: 'existsQuestion:notResolved', descricao: rawDesc, examType: examTypeRaw });
			return res.json({ exists: false, reason: 'examType not resolved' });
		}
		const rows = await sequelize.query('SELECT id FROM public.questao WHERE exam_type_id = :examTypeId AND LOWER(TRIM(descricao)) = LOWER(TRIM(:descricao)) AND (excluido = FALSE OR excluido IS NULL) LIMIT 1', { replacements: { examTypeId, descricao: rawDesc }, type: sequelize.QueryTypes.SELECT });
		if (rows && rows[0] && rows[0].id != null) {
			logQuestionSubmission({ route: 'existsQuestion:found', descricao: rawDesc, examType: examTypeId, id: Number(rows[0].id) });
			return res.json({ exists: true, id: Number(rows[0].id) });
		}
		logQuestionSubmission({ route: 'existsQuestion:notFound', descricao: rawDesc, examType: examTypeId });
		return res.json({ exists: false });
	} catch (e) {
		logger.error('existsQuestion error:', e);
		logQuestionSubmission({ route: 'existsQuestion:error', error: e && e.message });
		return next(internalError('internal error', 'EXISTS_QUESTION_ERROR', e));
	}
};

// Helper: normalize one question record from JSON
function normalizeQuestionJson(item, defaults){
	const o = item || {};
	const tiposlug = (o.tiposlug || o.tipo || '').toString().toLowerCase() || null;
	const iddominio = (o.iddominio != null ? Number(o.iddominio) : defaults.iddominio);
	const codareaconhecimento = (o.codareaconhecimento != null ? Number(o.codareaconhecimento) : defaults.codareaconhecimento);
	const codgrupoprocesso = (o.codgrupoprocesso != null ? Number(o.codgrupoprocesso) : defaults.codgrupoprocesso);
	const iddominiogeral = (o.iddominiogeral != null ? Number(o.iddominiogeral) : defaults.iddominiogeral);
	const examTypeSlug = (o.examTypeSlug || o.examType || defaults.examTypeSlug || '').toString().toLowerCase();
	const examTypeId = (o.examTypeId != null ? Number(o.examTypeId) : (defaults.examTypeId != null ? Number(defaults.examTypeId) : null));
	const id_task = (o.id_task != null ? Number(o.id_task) : (defaults.id_task != null ? Number(defaults.id_task) : null));
	const dica = o.dica != null ? String(o.dica) : (defaults.dica || null);
	const descricao = String(o.descricao || o.texto || o.enunciado || '');
	const options = Array.isArray(o.options) ? o.options : (Array.isArray(o.alternativas) ? o.alternativas.map(a=>({ descricao: a.texto||a.descricao||'', correta: !!a.correta })) : []);
	const explicacao = (o.explicacao != null) ? String(o.explicacao) : null;
	return { descricao, tiposlug, iddominio, codareaconhecimento, codgrupoprocesso, iddominiogeral, id_task, dica, options, examTypeSlug, examTypeId, explicacao };
}

// Helper: parse XML payload into array of normalized questions
function parseQuestionsFromXml(xmlText){
	const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', allowBooleanAttributes: true, trimValues: true });
	const j = parser.parse(xmlText || '');
	// Expected root <questions examType="pmp">
	const root = j && (j.questions || j.questoes);
	if (!root) return { defaults: {}, items: [] };
	const defaults = {
		examTypeSlug: (root.examType || root.exam_type || root.tipo || '').toString().toLowerCase() || '',
		iddominio: root.iddominio != null ? Number(root.iddominio) : undefined,
		codareaconhecimento: root.codareaconhecimento != null ? Number(root.codareaconhecimento) : undefined,
		codgrupoprocesso: root.codgrupoprocesso != null ? Number(root.codgrupoprocesso) : undefined,
		iddominiogeral: root.iddominiogeral != null ? Number(root.iddominiogeral) : undefined,
		id_task: root.id_task != null ? Number(root.id_task) : undefined,
		dica: root.dica != null ? String(root.dica) : undefined,
	};
	let arr = root.question || root.questao || [];
	if (!Array.isArray(arr)) arr = [arr];
	const items = arr.map(q => {
		// options may be <options><option correta="true">Texto</option></options>
		let options = [];
		try{
			const optsRoot = q.options || q.alternativas || {};
			let opts = optsRoot.option || optsRoot.alternativa || [];
			if (!Array.isArray(opts)) opts = [opts];
			options = opts.map(o => ({ descricao: (o.text || o.descricao || o._ || '').toString(), correta: !!(o.correta === true || o.correta === 'true' || o.correta === 1 || o.correta === '1') }));
		} catch(_){}
		return {
			descricao: String(q.descricao || q.texto || q.enunciado || ''),
			tiposlug: (q.tiposlug || q.tipo || '').toString().toLowerCase() || '',
			iddominio: q.iddominio != null ? Number(q.iddominio) : undefined,
			codareaconhecimento: q.codareaconhecimento != null ? Number(q.codareaconhecimento) : undefined,
			codgrupoprocesso: q.codgrupoprocesso != null ? Number(q.codgrupoprocesso) : undefined,
			iddominiogeral: q.iddominiogeral != null ? Number(q.iddominiogeral) : undefined,
			id_task: q.id_task != null ? Number(q.id_task) : undefined,
			dica: q.dica != null ? String(q.dica) : undefined,
			options,
			examTypeSlug: (q.examType || q.exam_type || '').toString().toLowerCase() || '',
			explicacao: (q.explicacao != null) ? String(q.explicacao) : null,
		};
	});
	return { defaults, items };
}

// POST /api/questions/bulk (JSON body) or multipart/form-data with file (JSON or XML)
exports.bulkCreateQuestions = async (req, res, next) => {
	try {
		let payload = null;
		let format = 'json';
		if (req.file && req.file.buffer) {
			const name = (req.file.originalname || '').toLowerCase();
			if (name.endsWith('.xml')) format = 'xml';
			const text = req.file.buffer.toString('utf8');
			if (format === 'xml') {
				const { defaults, items } = parseQuestionsFromXml(text);
				payload = { defaults, questions: items };
			} else {
				payload = JSON.parse(text);
			}
		} else {
			payload = req.body;
		}

		// Normalize JSON payload
		let defaults = { iddominio: undefined, codareaconhecimento: undefined, codgrupoprocesso: undefined, id_task: undefined, dica: undefined, examTypeSlug: undefined, examTypeId: undefined };
		let items = [];
		if (Array.isArray(payload)) {
			items = payload.map(q => normalizeQuestionJson(q, defaults));
		} else if (payload && typeof payload === 'object') {
			defaults = {
				iddominio: payload.iddominio != null ? Number(payload.iddominio) : undefined,
				codareaconhecimento: payload.codareaconhecimento != null ? Number(payload.codareaconhecimento) : undefined,
				codgrupoprocesso: payload.codgrupoprocesso != null ? Number(payload.codgrupoprocesso) : undefined,
				id_task: payload.id_task != null ? Number(payload.id_task) : undefined,
				dica: payload.dica != null ? String(payload.dica) : undefined,
				examTypeSlug: (payload.examTypeSlug || payload.examType || '').toString().toLowerCase() || undefined,
				examTypeId: payload.examTypeId != null ? Number(payload.examTypeId) : undefined,
			};
			const qs = Array.isArray(payload.questions) ? payload.questions : [];
			items = qs.map(q => normalizeQuestionJson(q, defaults));
		} else {
			return next(badRequest('Invalid payload', 'INVALID_PAYLOAD'));
		}

		// Must have examType (batch-level or per-item)
		const uniqueSlugs = new Set();
		const uniqueIds = new Set();
		items.forEach(it => {
			if (it.examTypeId != null) uniqueIds.add(Number(it.examTypeId));
			else if (it.examTypeSlug) uniqueSlugs.add(String(it.examTypeSlug));
			else if (defaults.examTypeId != null) uniqueIds.add(Number(defaults.examTypeId));
			else if (defaults.examTypeSlug) uniqueSlugs.add(String(defaults.examTypeSlug));
		});
		if (!uniqueSlugs.size && !uniqueIds.size) {
			return next(badRequest('examType required at batch or per question', 'EXAM_TYPE_REQUIRED'));
		}

		// Resolve slugs -> ids in one query
		const slugMap = new Map();
		if (uniqueSlugs.size) {
			const slugs = Array.from(uniqueSlugs);
			const rows = await sequelize.query('SELECT id, slug FROM public.exam_type WHERE slug = ANY(:slugs) AND (ativo = TRUE OR ativo IS NULL)', { replacements: { slugs }, type: sequelize.QueryTypes.SELECT });
			(rows || []).forEach(r => slugMap.set(String(r.slug).toLowerCase(), Number(r.id)));
		}

		// Audit user for bulk explanation rows (required now)
		const bulkCreatedByUserId = Number.isFinite(Number((req.body && req.body.createdByUserId) || (payload && payload.createdByUserId))) ? Number((req.body && req.body.createdByUserId) || (payload && payload.createdByUserId)) : null;
		if (!Number.isFinite(bulkCreatedByUserId) || bulkCreatedByUserId <= 0) {
			return next(badRequest('createdByUserId required for bulk', 'CREATED_BY_REQUIRED'));
		}
		try {
			const urow = await sequelize.query('SELECT "Id" FROM public."Usuario" WHERE "Id" = :uid LIMIT 1', { replacements: { uid: bulkCreatedByUserId }, type: sequelize.QueryTypes.SELECT });
			if (!urow || !urow[0] || urow[0].Id == null) {
				return next(badRequest('createdByUserId not found', 'CREATED_BY_NOT_FOUND'));
			}
		} catch(e){ return next(internalError('user lookup failed', 'USER_LOOKUP_FAILED', e)); }
		const results = [];
		let inserted = 0;
		await sequelize.transaction(async (t) => {
			for (let i = 0; i < items.length; i++) {
				const q = items[i];
				try {
					const descricao = (q.descricao || '').trim();
					if (!descricao) throw new Error('descricao required');
					const tiposlug = (q.tiposlug || '').trim().toLowerCase() || null;
					let multipla = null;
					if (multipla == null && tiposlug) {
						if (['multi','multiple','checkbox'].includes(tiposlug)) multipla = true; else if (['single','radio'].includes(tiposlug)) multipla = false;
					}
					if (multipla == null) multipla = false;
				const iddominio = (q.iddominio != null ? Number(q.iddominio) : 1);
				const codgrupoprocesso = (q.codgrupoprocesso != null ? Number(q.codgrupoprocesso) : null);
				const iddominiogeral = (q.iddominiogeral != null ? Number(q.iddominiogeral) : null);
				const id_task = (q.id_task != null ? Number(q.id_task) : null);
				const dica = q.dica || null;
					const examTypeId = (q.examTypeId != null ? Number(q.examTypeId) : (q.examTypeSlug ? slugMap.get(String(q.examTypeSlug).toLowerCase()) : (defaults.examTypeId != null ? Number(defaults.examTypeId) : (defaults.examTypeSlug ? slugMap.get(String(defaults.examTypeSlug).toLowerCase()) : null))));
					if (!Number.isFinite(examTypeId)) throw new Error('invalid or missing examType');

				// Insert question
				const insertQ = `INSERT INTO public.questao (
					iddominio, idstatus, descricao, datacadastro, dataalteracao,
					criadousuario, alteradousuario, excluido, seed, nivel,
					idprincipio, dica, multiplaescolha, codigocategoria, codgrupoprocesso, tiposlug, exam_type_id, iddominiogeral, id_task
				) VALUES (
					:iddominio, 1, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
					1, 1, false, false, 1,
					NULL, :dica, :multipla, NULL, :codgrupoprocesso, :tiposlug, :exam_type_id, :iddominiogeral, :id_task
				) RETURNING id`;
				const r = await sequelize.query(insertQ, { replacements: { iddominio, descricao, dica, multipla, codgrupoprocesso, tiposlug: tiposlug || (multipla ? 'multi' : 'single'), exam_type_id: examTypeId, iddominiogeral, id_task }, type: sequelize.QueryTypes.INSERT, transaction: t });
					const insertedRow = Array.isArray(r) && r[0] && Array.isArray(r[0]) ? r[0][0] : null;
					const qid = insertedRow && insertedRow.id ? Number(insertedRow.id) : null;
					if (!qid) throw new Error('Could not retrieve question id');

					// Options are master data; no insertion performed for bulk.

					// Optional explanation (normalized lowercase + audit)
					if (q.explicacao) {
						try {
							const insertE = `INSERT INTO public.explicacaoguia (idquestao, descricao, datacadastro, dataalteracao, excluido, criadousuario, alteradousuario)
											 VALUES (:qid, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, false, :uid, :uid)`;
							await sequelize.query(insertE, { replacements: { qid, descricao: String(q.explicacao), uid: bulkCreatedByUserId }, type: sequelize.QueryTypes.INSERT, transaction: t });
						} catch(_) { /* ignore optional failure */ }
					}

					results.push({ index: i, id: qid });
					inserted += 1;
				} catch (e) {
					results.push({ index: i, error: e.message || String(e) });
				}
			}
		});

		return res.status(201).json({ inserted, total: items.length, failed: items.length - inserted, results });
	} catch (err) {
		logger.error('bulkCreateQuestions error:', err);
		return next(internalError('Internal error', 'BULK_CREATE_QUESTIONS_ERROR', err));
	}
};
