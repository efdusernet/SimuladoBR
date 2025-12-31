const { badRequest, internalError } = require('../middleware/errors');
const requireAdmin = require('../middleware/requireAdmin');
const { chat } = require('../services/ollamaClient');
const { getWebConfig, webSearch, webFetchText, truncateText } = require('../services/webContext');

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

module.exports = {
  requireAdmin,
  searchWeb,
  fetchWeb,
  auditQuestion,
};
