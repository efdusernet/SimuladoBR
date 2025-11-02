const sequelize = require('../config/database');

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
		const dica = (b.dica || null);
		const options = Array.isArray(b.options) ? b.options : [];

		let createdId = null;
		await sequelize.transaction(async (t) => {
			// Insert question
			const insertQ = `INSERT INTO public.questao (
					iddominio, idstatus, descricao, datacadastro, dataalteracao,
					criadousuario, alteradousuario, excluido, seed, nivel,
					idprincipio, dica, multiplaescolha, codigocategoria, codareaconhecimento, codgrupoprocesso, tiposlug
				) VALUES (
					:iddominio, 1, :descricao, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
					1, 1, false, false, 1,
					NULL, :dica, :multipla, NULL, :codareaconhecimento, :codgrupoprocesso, :tiposlug
				) RETURNING id`;
			const r = await sequelize.query(insertQ, { replacements: { iddominio, descricao, dica, multipla, codareaconhecimento, codgrupoprocesso, tiposlug: tiposlug || (multipla ? 'multi' : 'single') }, type: sequelize.QueryTypes.INSERT, transaction: t });
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
			// Insert options if provided
			if (Array.isArray(options) && options.length) {
				for (const opt of options) {
					const od = (opt && (opt.descricao || opt.text)) ? String(opt.descricao || opt.text) : '';
					if (!od) continue;
					const correta = !!(opt && (opt.correta === true || opt.isCorreta === true));
					const insertO = `INSERT INTO public.respostaopcao ("IdQuestao", "Descricao", "IsCorreta", "DataCadastro", "DataAlteracao", "CriadoUsuario", "AlteradoUsuario", "Excluido")
													 VALUES (:qid, :od, :correta, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 1, false)`;
					await sequelize.query(insertO, { replacements: { qid: createdId, od, correta }, type: sequelize.QueryTypes.INSERT, transaction: t });
				}
			}
		});

		return res.status(201).json({ id: createdId });
	} catch (err) {
		console.error('createQuestion error:', err);
		return res.status(500).json({ error: 'Internal error' });
	}
};
