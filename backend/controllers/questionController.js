const sequelize = require('../config/database');
const { XMLParser } = require('fast-xml-parser');

exports.createQuestion = async (req, res) => {
	try {
		const b = req.body || {};
		const descricao = (b.descricao || '').trim();
		if (!descricao) return res.status(400).json({ error: 'descricao required' });
		// Decide tipo e multiplaescolha
		const tiposlug = (b.tiposlug || '').trim().toLowerCase() || null;
		let multipla = null;
		if (typeof b.multiplaescolha === 'boolean') multipla = b.multiplaescolha;
		if (multipla == null && tiposlug) {
			if (['multi','multiple','checkbox'].includes(tiposlug)) multipla = true; else if (['single','radio'].includes(tiposlug)) multipla = false;
		}
		if (multipla == null) multipla = false;
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
			if (!resolvedExamTypeId) return res.status(400).json({ error: 'examType required' });

		let createdId = null;
		await sequelize.transaction(async (t) => {
		// Insert question
		const insertQ = `INSERT INTO public.questao (
			iddominio, idstatus, descricao, datacadastro, dataalteracao,
			criadousuario, alteradousuario, excluido, seed, nivel,
			idprincipio, dica, multiplaescolha, codigocategoria, codareaconhecimento, codgrupoprocesso, tiposlug, exam_type_id, iddominiogeral, imagem_url, codniveldificuldade, id_task
		) VALUES (
			:iddominio, 1, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
			1, 1, false, false, 1,
			:idprincipio, :dica, :multipla, :codigocategoria, :codareaconhecimento, :codgrupoprocesso, :tiposlug, :exam_type_id, :iddominiogeral, :imagem_url, :codniveldificuldade, :id_task
		) RETURNING id`;
		const r = await sequelize.query(insertQ, { replacements: { iddominio, descricao, dica, multipla, codareaconhecimento, codgrupoprocesso, codigocategoria, tiposlug: tiposlug || (multipla ? 'multi' : 'single'), exam_type_id: resolvedExamTypeId, iddominiogeral, idprincipio, imagem_url: imagemUrl, codniveldificuldade, id_task }, type: sequelize.QueryTypes.INSERT, transaction: t });
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
			// Options are master data; no insertion performed.
			// Insert explicacao if provided
			if (explicacao != null && explicacao !== '') {
				const insertE = `INSERT INTO public.explicacaoguia (idquestao, "Descricao", "DataCadastro", "DataAlteracao", "CriadoUsuario", "AlteradoUsuario", "Excluido")
												 VALUES (:qid, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1, false)`;
				await sequelize.query(insertE, { replacements: { qid: createdId, descricao: explicacao }, type: sequelize.QueryTypes.INSERT, transaction: t });
			}
		});

		return res.status(201).json({ id: createdId });
	} catch (err) {
		console.error('createQuestion error:', err);
		return res.status(500).json({ error: 'Internal error' });
	}
};

// List questions (IDs) with pagination and ordering
exports.listQuestions = async (req, res) => {
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
		console.error('listQuestions error:', e);
		return res.status(500).json({ error: 'internal error' });
	}
};

// Get single question with options and explanation
exports.getQuestionById = async (req, res) => {
	try {
		const id = Number(req.params.id);
		if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

	const qsql = `SELECT q.id, q.descricao, q.tiposlug, q.iddominio, q.codareaconhecimento, q.codgrupoprocesso, q.iddominiogeral, q.idprincipio, q.codigocategoria,
											 q.dica, q.imagem_url, q.multiplaescolha, q.codniveldificuldade, q.id_task, q.exam_type_id,
											 et.slug AS exam_type_slug, et.nome AS exam_type_nome
								FROM public.questao q
								LEFT JOIN public.exam_type et ON et.id = q.exam_type_id
								WHERE q.id = :id`;
		const row = await sequelize.query(qsql, { replacements: { id }, type: sequelize.QueryTypes.SELECT });
		if (!row || !row[0]) return res.status(404).json({ error: 'not found' });
		const base = row[0];

		const osql = `SELECT "Descricao" AS descricao, "IsCorreta" AS correta
									FROM public.respostaopcao
									WHERE "IdQuestao" = :id AND ("Excluido" = FALSE OR "Excluido" IS NULL)`;
		const opts = await sequelize.query(osql, { replacements: { id }, type: sequelize.QueryTypes.SELECT });

		let explicacao = null;
		try {
			const esql = `SELECT "Descricao" FROM public.explicacaoguia
										WHERE idquestao = :id AND ("Excluido" = FALSE OR "Excluido" IS NULL)
										ORDER BY "DataAlteracao" DESC LIMIT 1`;
			const erow = await sequelize.query(esql, { replacements: { id }, type: sequelize.QueryTypes.SELECT });
			if (erow && erow[0] && erow[0].Descricao != null) explicacao = String(erow[0].Descricao);
		} catch(_) {}

		return res.json({
			id: base.id,
			descricao: base.descricao,
			tiposlug: base.tiposlug,
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
			explicacao,
			options: opts || [],
			examType: { id: base.exam_type_id, slug: base.exam_type_slug, nome: base.exam_type_nome }
		});
	} catch (e) {
		console.error('getQuestionById error:', e);
		return res.status(500).json({ error: 'internal error' });
	}
};

// Update a question and replace options/explicacao
exports.updateQuestion = async (req, res) => {
	try {
		const id = Number(req.params.id);
		if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
		const b = req.body || {};

		const descricao = (b.descricao || '').trim();
		if (!descricao) return res.status(400).json({ error: 'descricao required' });
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
		const explicacao = (b.explicacao != null) ? String(b.explicacao) : null;
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
				iddominio = :iddominio,
				codareaconhecimento = :codareaconhecimento,
				codgrupoprocesso = :codgrupoprocesso,
				iddominiogeral = :iddominiogeral,
				idprincipio = :idprincipio,
				codigocategoria = :codigocategoria,
				dica = :dica,
				imagem_url = :imagem_url,
				codniveldificuldade = :codniveldificuldade,
				id_task = :id_task,
				exam_type_id = COALESCE(:exam_type_id, exam_type_id),
				dataalteracao = CURRENT_TIMESTAMP,
				alteradousuario = 1
			WHERE id = :id`;
			await sequelize.query(upQ, { replacements: { id, descricao, tiposlug: tiposlug || (multipla ? 'multi' : 'single'), multipla, iddominio, codareaconhecimento, codgrupoprocesso, iddominiogeral, idprincipio, codigocategoria, dica, imagem_url: imagemUrl, codniveldificuldade, id_task, exam_type_id: resolvedExamTypeId }, type: sequelize.QueryTypes.UPDATE, transaction: t });

			// Options are master data; no update or reinsertion performed.

			// Replace explanation
			await sequelize.query(`UPDATE public.explicacaoguia SET "Excluido" = TRUE, "DataAlteracao" = CURRENT_TIMESTAMP WHERE idquestao = :id AND ("Excluido" = FALSE OR "Excluido" IS NULL)`, { replacements: { id }, type: sequelize.QueryTypes.UPDATE, transaction: t });
			if (explicacao != null) {
				await sequelize.query(`INSERT INTO public.explicacaoguia (idquestao, "Descricao", "DataCadastro", "DataAlteracao", "CriadoUsuario", "AlteradoUsuario", "Excluido")
															 VALUES (:id, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1, false)`, { replacements: { id, descricao: explicacao }, type: sequelize.QueryTypes.INSERT, transaction: t });
			}
		});

		return res.json({ ok: true, id });
	} catch (e) {
		console.error('updateQuestion error:', e);
		return res.status(500).json({ error: 'internal error' });
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
	const dica = o.dica != null ? String(o.dica) : (defaults.dica || null);
	const descricao = String(o.descricao || o.texto || o.enunciado || '');
	const options = Array.isArray(o.options) ? o.options : (Array.isArray(o.alternativas) ? o.alternativas.map(a=>({ descricao: a.texto||a.descricao||'', correta: !!a.correta })) : []);
	const explicacao = (o.explicacao != null) ? String(o.explicacao) : null;
	return { descricao, tiposlug, iddominio, codareaconhecimento, codgrupoprocesso, iddominiogeral, dica, options, examTypeSlug, examTypeId, explicacao };
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
			dica: q.dica != null ? String(q.dica) : undefined,
			options,
			examTypeSlug: (q.examType || q.exam_type || '').toString().toLowerCase() || '',
			explicacao: (q.explicacao != null) ? String(q.explicacao) : null,
		};
	});
	return { defaults, items };
}

// POST /api/questions/bulk (JSON body) or multipart/form-data with file (JSON or XML)
exports.bulkCreateQuestions = async (req, res) => {
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
		let defaults = { iddominio: undefined, codareaconhecimento: undefined, codgrupoprocesso: undefined, dica: undefined, examTypeSlug: undefined, examTypeId: undefined };
		let items = [];
		if (Array.isArray(payload)) {
			items = payload.map(q => normalizeQuestionJson(q, defaults));
		} else if (payload && typeof payload === 'object') {
			defaults = {
				iddominio: payload.iddominio != null ? Number(payload.iddominio) : undefined,
				codareaconhecimento: payload.codareaconhecimento != null ? Number(payload.codareaconhecimento) : undefined,
				codgrupoprocesso: payload.codgrupoprocesso != null ? Number(payload.codgrupoprocesso) : undefined,
				dica: payload.dica != null ? String(payload.dica) : undefined,
				examTypeSlug: (payload.examTypeSlug || payload.examType || '').toString().toLowerCase() || undefined,
				examTypeId: payload.examTypeId != null ? Number(payload.examTypeId) : undefined,
			};
			const qs = Array.isArray(payload.questions) ? payload.questions : [];
			items = qs.map(q => normalizeQuestionJson(q, defaults));
		} else {
			return res.status(400).json({ error: 'Invalid payload' });
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
			return res.status(400).json({ error: 'examType required at batch or per question' });
		}

		// Resolve slugs -> ids in one query
		const slugMap = new Map();
		if (uniqueSlugs.size) {
			const slugs = Array.from(uniqueSlugs);
			const rows = await sequelize.query('SELECT id, slug FROM public.exam_type WHERE slug = ANY(:slugs) AND (ativo = TRUE OR ativo IS NULL)', { replacements: { slugs }, type: sequelize.QueryTypes.SELECT });
			(rows || []).forEach(r => slugMap.set(String(r.slug).toLowerCase(), Number(r.id)));
		}

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
				const codareaconhecimento = (q.codareaconhecimento != null ? Number(q.codareaconhecimento) : null);
				const codgrupoprocesso = (q.codgrupoprocesso != null ? Number(q.codgrupoprocesso) : null);
				const iddominiogeral = (q.iddominiogeral != null ? Number(q.iddominiogeral) : null);
				const dica = q.dica || null;
					const examTypeId = (q.examTypeId != null ? Number(q.examTypeId) : (q.examTypeSlug ? slugMap.get(String(q.examTypeSlug).toLowerCase()) : (defaults.examTypeId != null ? Number(defaults.examTypeId) : (defaults.examTypeSlug ? slugMap.get(String(defaults.examTypeSlug).toLowerCase()) : null))));
					if (!Number.isFinite(examTypeId)) throw new Error('invalid or missing examType');

				// Insert question
				const insertQ = `INSERT INTO public.questao (
					iddominio, idstatus, descricao, datacadastro, dataalteracao,
					criadousuario, alteradousuario, excluido, seed, nivel,
					idprincipio, dica, multiplaescolha, codigocategoria, codareaconhecimento, codgrupoprocesso, tiposlug, exam_type_id, iddominiogeral
				) VALUES (
					:iddominio, 1, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
					1, 1, false, false, 1,
					NULL, :dica, :multipla, NULL, :codareaconhecimento, :codgrupoprocesso, :tiposlug, :exam_type_id, :iddominiogeral
				) RETURNING id`;
				const r = await sequelize.query(insertQ, { replacements: { iddominio, descricao, dica, multipla, codareaconhecimento, codgrupoprocesso, tiposlug: tiposlug || (multipla ? 'multi' : 'single'), exam_type_id: examTypeId, iddominiogeral }, type: sequelize.QueryTypes.INSERT, transaction: t });
					const insertedRow = Array.isArray(r) && r[0] && Array.isArray(r[0]) ? r[0][0] : null;
					const qid = insertedRow && insertedRow.id ? Number(insertedRow.id) : null;
					if (!qid) throw new Error('Could not retrieve question id');

					// Options are master data; no insertion performed for bulk.

					// Optional explanation
					if (q.explicacao) {
						try {
							const insertE = `INSERT INTO public.explicacaoguia (idquestao, "Descricao", "DataCadastro", "DataAlteracao", "CriadoUsuario", "AlteradoUsuario", "Excluido")
															 VALUES (:qid, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1, false)`;
							await sequelize.query(insertE, { replacements: { qid, descricao: String(q.explicacao) }, type: sequelize.QueryTypes.INSERT, transaction: t });
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
		console.error('bulkCreateQuestions error:', err);
		return res.status(500).json({ error: 'Internal error' });
	}
};
