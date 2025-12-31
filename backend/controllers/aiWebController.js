const { badRequest, internalError } = require('../middleware/errors');
const requireAdmin = require('../middleware/requireAdmin');
const { chat } = require('../services/ollamaClient');
const { getWebConfig, webSearch, webFetchText, truncateText } = require('../services/webContext');
const { getQuestionClassificationMasterdata } = require('../services/masterdataService');

function clampInt(v, def, { min, max } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const x = Math.floor(n);
  if (Number.isFinite(min) && x < min) return def;
  if (Number.isFinite(max) && x > max) return def;
  return x;
}

function safeString(v, maxLen = 2000) {
  const s = String(v == null ? '' : v);
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

async function searchWeb(req, res, next) {
  try {
    const cfg = getWebConfig();
    const q = safeString(req.query.q, 500);
    const k = clampInt(req.query.k, 5, { min: 1, max: 10 });
    if (!q) return next(badRequest('Parâmetro q é obrigatório', 'WEB_SEARCH_QUERY_REQUIRED'));

    const out = await webSearch(q, { cfg, count: k });
    return res.json({ success: true, meta: { webEnabled: cfg.enabled }, ...out });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Erro';
    if (err && err.code === 'WEB_SEARCH_NOT_CONFIGURED') {
      return next(badRequest(msg, 'WEB_SEARCH_NOT_CONFIGURED'));
    }
    return next(internalError('Falha ao buscar na web', 'WEB_SEARCH_ERROR', { error: msg }));
  }
}

async function fetchWeb(req, res, next) {
  try {
    const cfg = getWebConfig();
    const url = safeString(req.body && req.body.url, 2000);
    if (!url) return next(badRequest('Body.url é obrigatório', 'WEB_FETCH_URL_REQUIRED'));

    const page = await webFetchText(url, { cfg });
    return res.json({ success: true, meta: { webEnabled: cfg.enabled }, page });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Erro';
    return next(internalError('Falha ao buscar conteúdo da web', 'WEB_FETCH_ERROR', { error: msg }));
  }
}

async function auditQuestion(req, res, next) {
  try {
    const cfg = getWebConfig();
    const body = req.body || {};
    const question = body.question || {};

    const descricao = safeString(question.descricao, 4000);
    const examType = safeString(question.examType || question.examTypeSlug || question.examTypeName || '', 80);
    const alternativas = Array.isArray(question.alternativas) ? question.alternativas.map(a => safeString(a, 800)).filter(Boolean) : [];
    const correta = safeString(question.correta, 50);

    if (!descricao) return next(badRequest('question.descricao é obrigatório', 'QUESTION_DESCRICAO_REQUIRED'));

    const web = body.web || {};
    const query = safeString(web.query, 400) || truncateText(descricao, 220);
    const maxSources = clampInt(web.maxSources, 4, { min: 1, max: 6 });

    let sources = [];
    if (web && web.enabled !== false) {
      const search = await webSearch(query, { cfg, count: Math.min(maxSources, 6) });
      const urls = (search.results || []).map(r => r.url).filter(Boolean).slice(0, maxSources);

      const pages = [];
      for (const u of urls) {
        try {
          const page = await webFetchText(u, { cfg });
          pages.push({
            url: page.url,
            title: page.title || null,
            contentType: page.contentType || null,
            excerpt: page.text || '',
          });
        } catch (e) {
          // best-effort: ignore a single source failure
        }
      }

      sources = pages;
    }

    const system = {
      role: 'system',
      content: [
        'Você é um revisor técnico de questões de prova.',
        'Responda em PT-BR.',
        'Use APENAS o que estiver em "question" e nas "sources" fornecidas.',
        'Se as sources forem insuficientes para validar um ponto, marque como "uncertain" e explique brevemente.',
        'Retorne JSON estritamente válido no schema pedido; sem Markdown; sem texto fora do JSON.'
      ].join(' ')
    };

    const user = {
      role: 'user',
      content: JSON.stringify({
        task: 'Auditar coerência e correção de uma questão (enunciado + alternativas).',
        question: {
          descricao,
          examType: examType || null,
          alternativas,
          correta: correta || null,
        },
        sources,
        outputSchema: {
          verdict: 'ok|warning|problem',
          issues: 'array de itens {type, message, severity: low|medium|high, uncertain: boolean, sourceUrls: string[]}',
          suggestions: 'array de strings curtas',
          correctedVersion: 'opcional: {descricao, alternativas, correta}',
          sourcesUsed: 'array de {url, title}'
        },
        hardRules: {
          maxIssues: 8,
          maxSuggestions: 6,
          maxTextPerField: 800,
          noExtraKeys: true
        }
      })
    };

    const llm = await chat({
      messages: [system, user],
      format: 'json',
      options: { temperature: 0.1, num_predict: 420 },
    });

    const content = llm && llm.message && llm.message.content ? llm.message.content : '';
    let parsed = null;
    try {
      parsed = JSON.parse(String(content || '').trim());
    } catch (e) {
      return next(internalError('Ollama retornou JSON inválido', 'AI_AUDIT_BAD_JSON', { raw: String(content || '').slice(0, 2000) }));
    }

    return res.json({
      success: true,
      meta: {
        model: llm.model || null,
        usedWeb: Boolean(sources && sources.length),
        sourcesCount: sources.length,
        query,
      },
      audit: parsed,
      sources,
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Erro';
    return next(internalError('Falha ao auditar questão via IA', 'AI_QUESTION_AUDIT_ERROR', { error: msg }));
  }
}

function toIntOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function buildAllowedIdSet(items) {
  const set = new Set();
  for (const it of (items || [])) {
    const n = Number(it && it.id);
    if (Number.isFinite(n)) set.add(Math.floor(n));
  }
  return set;
}

function normalizeCurrentSelections(current) {
  const c = current || {};
  return {
    iddominiogeral: toIntOrNull(c.iddominiogeral),
    iddominio: toIntOrNull(c.iddominio),
    idprincipio: toIntOrNull(c.idprincipio),
    codigocategoria: toIntOrNull(c.codigocategoria),
    codgrupoprocesso: toIntOrNull(c.codgrupoprocesso),
    id_task: toIntOrNull(c.id_task),
  };
}

async function classifyQuestion(req, res, next) {
  try {
    const body = req.body || {};
    const question = body.question || {};
    const current = normalizeCurrentSelections(body.current || body.currentSelections || body.selected || {});

    const descricao = safeString(question.descricao, 4000);
    const alternativas = Array.isArray(question.alternativas) ? question.alternativas.map(a => safeString(a, 800)).filter(Boolean) : [];
    const correta = safeString(question.correta, 50);

    if (!descricao) return next(badRequest('question.descricao é obrigatório', 'QUESTION_DESCRICAO_REQUIRED'));

    const dicaMaxChars = clampInt(body.dicaMaxChars, 180, { min: 60, max: 400 });

    const masterdata = await getQuestionClassificationMasterdata();
    const allowed = {
      iddominiogeral: buildAllowedIdSet(masterdata.iddominiogeral),
      iddominio: buildAllowedIdSet(masterdata.iddominio),
      idprincipio: buildAllowedIdSet(masterdata.idprincipio),
      codigocategoria: buildAllowedIdSet(masterdata.codigocategoria),
      codgrupoprocesso: buildAllowedIdSet(masterdata.codgrupoprocesso),
      id_task: buildAllowedIdSet(masterdata.id_task),
    };

    const system = {
      role: 'system',
      content: [
        'Você é um especialista em classificação de questões de prova (PMP/PMBOK).',
        'Responda em PT-BR.',
        'NUNCA invente IDs. Você só pode escolher IDs presentes no dicionário (masterdata) fornecido.',
        'Se não houver evidência suficiente no enunciado, retorne suggestedId=null e confidence="low" com reason curta.',
        `Para "dica", gere uma pista curta (máx ${dicaMaxChars} caracteres) sem revelar a alternativa correta diretamente.`,
        'Retorne JSON estritamente válido; sem Markdown; sem texto fora do JSON; não adicione chaves extras.'
      ].join(' ')
    };

    const user = {
      role: 'user',
      content: JSON.stringify({
        task: 'Classificar a questão e sugerir valores para campos de masterdata. Também indicar se o valor atual diverge da sugestão.',
        question: {
          descricao,
          alternativas,
          correta: correta || null,
        },
        current,
        masterdata,
        outputSchema: {
          context: { summary: 'string', tags: 'string[] (curtas)' },
          fields: {
            iddominiogeral: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            iddominio: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            idprincipio: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            codigocategoria: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            codgrupoprocesso: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            id_task: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
          },
          dica: { text: 'string|null', reason: 'string' }
        },
        hardRules: {
          dicaMaxChars,
          noExtraKeys: true
        }
      })
    };

    const llm = await chat({
      messages: [system, user],
      format: 'json',
      options: { temperature: 0.1, num_predict: 520 },
    });

    const content = llm && llm.message && llm.message.content ? llm.message.content : '';
    let parsed = null;
    try {
      parsed = JSON.parse(String(content || '').trim());
    } catch (e) {
      return next(internalError('Ollama retornou JSON inválido', 'AI_CLASSIFY_BAD_JSON', { raw: String(content || '').slice(0, 2000) }));
    }

    const out = {
      context: (parsed && parsed.context) ? parsed.context : { summary: '', tags: [] },
      fields: (parsed && parsed.fields) ? parsed.fields : {},
      dica: (parsed && parsed.dica) ? parsed.dica : { text: null, reason: '' },
    };

    const validationIssues = [];
    const disagreements = [];

    function validateField(fieldKey) {
      const field = out.fields && out.fields[fieldKey] ? out.fields[fieldKey] : null;
      const suggestedIdRaw = field && Object.prototype.hasOwnProperty.call(field, 'suggestedId') ? field.suggestedId : null;
      const suggestedId = toIntOrNull(suggestedIdRaw);
      const currentId = current[fieldKey];

      let finalSuggestedId = suggestedId;
      if (finalSuggestedId != null && !allowed[fieldKey].has(finalSuggestedId)) {
        validationIssues.push({ field: fieldKey, code: 'SUGGESTED_ID_NOT_ALLOWED', suggestedId: finalSuggestedId });
        finalSuggestedId = null;
      }

      const differsFromCurrent = (currentId != null && finalSuggestedId != null && currentId !== finalSuggestedId);
      if (differsFromCurrent) disagreements.push({ field: fieldKey, currentId, suggestedId: finalSuggestedId });

      out.fields[fieldKey] = {
        suggestedId: finalSuggestedId,
        currentId,
        differsFromCurrent,
        confidence: (field && field.confidence) ? field.confidence : 'low',
        reason: safeString(field && field.reason, 600) || '',
      };
    }

    for (const k of ['iddominiogeral', 'iddominio', 'idprincipio', 'codigocategoria', 'codgrupoprocesso', 'id_task']) {
      validateField(k);
    }

    // Enforce dica max chars
    const dicaText = safeString(out.dica && out.dica.text, dicaMaxChars + 50);
    let finalDicaText = dicaText || null;
    let dicaTruncated = false;
    if (finalDicaText && finalDicaText.length > dicaMaxChars) {
      finalDicaText = finalDicaText.slice(0, dicaMaxChars).trim();
      dicaTruncated = true;
    }
    out.dica = {
      text: finalDicaText,
      reason: safeString(out.dica && out.dica.reason, 600) || '',
    };

    return res.json({
      success: true,
      meta: {
        model: llm.model || null,
        dicaMaxChars,
        dicaTruncated,
        validationIssuesCount: validationIssues.length,
        disagreementsCount: disagreements.length,
      },
      result: out,
      validationIssues,
      disagreements,
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Erro';
    return next(internalError('Falha ao classificar questão via IA', 'AI_QUESTION_CLASSIFY_ERROR', { error: msg }));
  }
}

module.exports = {
  requireAdmin,
  searchWeb,
  fetchWeb,
  auditQuestion,
  classifyQuestion,
};
