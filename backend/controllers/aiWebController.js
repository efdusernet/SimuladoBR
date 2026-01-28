const { badRequest, internalError } = require('../middleware/errors');
const requireAdmin = require('../middleware/requireAdmin');
const llmClient = require('../services/llmClient');
const { getWebConfig, webSearch, webFetchText, truncateText } = require('../services/webContext');
const { getQuestionClassificationMasterdata } = require('../services/masterdataService');
const { tryParseJsonLenient } = require('../utils/jsonParseLenient');
const { logger } = require('../utils/logger');

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

function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s) {
  const t = normalizeForMatch(s);
  if (!t) return [];
  return t.split(' ').filter(w => w.length >= 3);
}

function pickTopMasterdata(items, queryText, { topK = 40, forceIncludeIds = [] } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const qNorm = normalizeForMatch(queryText);
  const qTokens = new Set(tokenize(qNorm));

  const scored = list.map((it) => {
    const id = Number(it && it.id);
    const desc = String((it && it.descricao) || '');
    const exp = String((it && it.explicacao) || '');
    const text = (exp && exp.trim()) ? `${desc} ${exp}` : desc;
    const dTokens = tokenize(text);
    let score = 0;
    for (const w of dTokens) {
      if (qTokens.has(w)) score += 2;
    }
    const dNorm = normalizeForMatch(text);
    if (dNorm && qNorm.includes(dNorm)) score += 8;
    return { it, id, score };
  });

  scored.sort((a, b) => (b.score - a.score));

  const forced = new Set((forceIncludeIds || []).map(x => Number(x)).filter(Number.isFinite));
  const out = [];
  for (const s of scored) {
    if (out.length >= topK) break;
    out.push(s.it);
  }

  // Ensure forced ids are included (e.g., current selections), even if not in topK.
  if (forced.size) {
    for (const s of scored) {
      if (!forced.has(s.id)) continue;
      const exists = out.some(x => Number(x && x.id) === s.id);
      if (!exists) out.push(s.it);
    }
  }

  // Preserve stable shape; avoid huge payload.
  return out.slice(0, Math.max(topK, out.length));
}

function scoreMasterdataItem(it, { qTokens, qNorm }) {
  const desc = String((it && it.descricao) || '');
  const exp = String((it && it.explicacao) || '');
  const text = (exp && exp.trim()) ? `${desc} ${exp}` : desc;
  const dTokens = tokenize(text);
  let score = 0;
  for (const w of dTokens) {
    if (qTokens.has(w)) score += 2;
  }
  const dNorm = normalizeForMatch(text);
  if (dNorm && qNorm.includes(dNorm)) score += 8;
  return score;
}

function bestMasterdataMatch(items, queryText) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { best: null, bestScore: 0, secondScore: 0 };

  const qNorm = normalizeForMatch(queryText);
  const qTokens = new Set(tokenize(qNorm));
  let best = null;
  let bestScore = -Infinity;
  let secondScore = -Infinity;
  for (const it of list) {
    const s = scoreMasterdataItem(it, { qTokens, qNorm });
    if (s > bestScore) {
      secondScore = bestScore;
      bestScore = s;
      best = it;
    } else if (s > secondScore) {
      secondScore = s;
    }
  }
  if (!Number.isFinite(bestScore)) bestScore = 0;
  if (!Number.isFinite(secondScore)) secondScore = 0;
  return { best, bestScore, secondScore };
}

function clampText(s, maxLen) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > maxLen ? t.slice(0, maxLen).trim() : t;
}

function firstSentence(s, maxLen = 180) {
  const t = clampText(s, maxLen * 2);
  if (!t) return '';
  const m = t.match(/^(.{20,}?[.!?])\s/);
  const out = m ? m[1] : t;
  return clampText(out, maxLen);
}

function keywordHintsFromQuestion(questionText, { max = 3 } = {}) {
  const stop = new Set([
    'para','como','uma','um','uns','umas','que','com','sem','por','das','dos','da','do','de','em','no','na','nos','nas',
    'sobre','entre','quando','onde','qual','quais','porque','pois','mais','menos','muito','pouco','tambem','também','ser',
    'estar','ter','tinha','tem','sao','são','foi','vai','ira','irá','deve','devem','pode','podem','projeto','questao','questão'
  ]);
  const toks = tokenize(questionText).filter(w => !stop.has(w));
  const freq = new Map();
  for (const w of toks) freq.set(w, (freq.get(w) || 0) + 1);
  const sorted = Array.from(freq.entries()).sort((a, b) => (b[1] - a[1]) || (a[0].localeCompare(b[0])));
  return sorted.slice(0, max).map(([w]) => w);
}

function findItemById(list, id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  const arr = Array.isArray(list) ? list : [];
  for (const it of arr) {
    if (Number(it && it.id) === n) return it;
  }
  return null;
}

function buildDeterministicReason({ questionText, chosenItem, maxLen = 480 }) {
  const chosenDesc = String((chosenItem && chosenItem.descricao) || '').trim();
  const chosenExp = String((chosenItem && chosenItem.explicacao) || '').trim();
  const itemText = (chosenExp ? `${chosenDesc} ${chosenExp}` : chosenDesc);

  const qNorm = normalizeForMatch(questionText);
  const qTokens = new Set(tokenize(qNorm));
  const itemTokens = tokenize(itemText);
  const overlap = [];
  for (const w of itemTokens) {
    if (qTokens.has(w) && !overlap.includes(w)) overlap.push(w);
    if (overlap.length >= 3) break;
  }
  const keywords = overlap.length ? overlap : keywordHintsFromQuestion(questionText, { max: 3 });
  const expSnippet = firstSentence(chosenExp, 180);

  const parts = [];
  if (keywords.length) parts.push(`Evidências: ${keywords.join(', ')}`);
  if (expSnippet) parts.push(`Critério: ${expSnippet}`);
  else if (chosenDesc) parts.push(`Escolha: ${chosenDesc}`);
  return clampText(parts.join('\n'), maxLen);
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

    const llm = await llmClient.chat({
      messages: [system, user],
      format: 'json',
      options: { temperature: 0.1, num_predict: 420 },
    });

    const content = llm && llm.message && llm.message.content ? llm.message.content : '';
    const raw = String(content || '').trim();
    const parsed = tryParseJsonLenient(raw);
    if (!parsed) {
      return next(internalError('LLM retornou JSON inválido', 'AI_AUDIT_BAD_JSON', {
        llmProvider: llmClient.getProvider(),
        model: llm && llm.model ? String(llm.model) : null,
        rawLen: raw.length,
        raw: raw.slice(0, 4000),
      }));
    }

    return res.json({
      success: true,
      meta: {
        model: llm.model || null,
        llmProvider: llmClient.getProvider(),
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
    iddominio_desempenho: toIntOrNull(c.iddominio_desempenho),
    idprincipio: toIntOrNull(c.idprincipio),
    id_abordagem: toIntOrNull(c.id_abordagem),
    codgrupoprocesso: toIntOrNull(c.codgrupoprocesso),
    id_task: toIntOrNull(c.id_task),
  };
}

async function classifyQuestion(req, res, next) {
  try {
    const cfg = getWebConfig();
    const body = req.body || {};
    const question = body.question || {};
    const current = normalizeCurrentSelections(body.current || body.currentSelections || body.selected || {});

    const descricao = safeString(question.descricao, 4000);
    const alternativas = Array.isArray(question.alternativas) ? question.alternativas.map(a => safeString(a, 800)).filter(Boolean) : [];
    const correta = safeString(question.correta, 50);

    if (!descricao) return next(badRequest('question.descricao é obrigatório', 'QUESTION_DESCRICAO_REQUIRED'));

    const dicaMaxChars = clampInt(body.dicaMaxChars, 180, { min: 60, max: 400 });
    const contextSummaryMaxChars = clampInt(
      body.contextSummaryMaxChars,
      clampInt(process.env.AI_CLASSIFY_CONTEXT_SUMMARY_MAX_CHARS, 400, { min: 100, max: 1200 }),
      { min: 100, max: 1200 }
    );
    const reasonMaxChars = clampInt(
      body.reasonMaxChars,
      clampInt(process.env.AI_CLASSIFY_REASON_MAX_CHARS, 480, { min: 180, max: 1200 }),
      { min: 180, max: 1200 }
    );

    // Confidence thresholds for deterministic best-match fallback (configurable).
    // Default is slightly conservative.
    const confHighScoreMin = clampInt(process.env.AI_CLASSIFY_CONF_HIGH_SCORE_MIN, 12, { min: 0, max: 9999 });
    const confHighMarginMin = clampInt(process.env.AI_CLASSIFY_CONF_HIGH_MARGIN_MIN, 7, { min: 0, max: 9999 });
    const confMedScoreMin = clampInt(process.env.AI_CLASSIFY_CONF_MED_SCORE_MIN, 7, { min: 0, max: 9999 });
    const confMedMarginMin = clampInt(process.env.AI_CLASSIFY_CONF_MED_MARGIN_MIN, 3, { min: 0, max: 9999 });

    const llmProvider = llmClient.getProvider();
    if (!llmClient.isEnabled()) {
      if (llmProvider === 'gemini') {
        return next(badRequest('Gemini não configurado (defina GEMINI_API_KEY no backend/.env)', 'GEMINI_NOT_CONFIGURED'));
      }
      return next(badRequest('Ollama desabilitado (defina OLLAMA_ENABLED=true no backend/.env)', 'OLLAMA_DISABLED'));
    }

    // Gemini tends to be very fast, but if maxOutputTokens is too small it can truncate JSON mid-output.
    const classifyMaxTokens = (llmProvider === 'gemini')
      ? clampInt(process.env.GEMINI_CLASSIFY_MAX_TOKENS, 700, { min: 200, max: 2048 })
      : clampInt(process.env.OLLAMA_CLASSIFY_NUM_PREDICT, 280, { min: 100, max: 2048 });

    // Classification tends to be heavier (masterdata + question). Avoid aborting too early,
    // because Ollama may keep generating server-side even after the client disconnects.
    const classifyTimeoutMs = (llmProvider === 'gemini')
      ? clampInt(
        process.env.GEMINI_CLASSIFY_TIMEOUT_MS,
        clampInt(process.env.GEMINI_TIMEOUT_MS, 120000, { min: 5000, max: 900000 }),
        { min: 5000, max: 900000 }
      )
      : clampInt(
        process.env.OLLAMA_CLASSIFY_TIMEOUT_MS,
        Math.max(
          720000,
          clampInt(process.env.OLLAMA_TIMEOUT_MS, 120000, { min: 5000, max: 900000 })
        ),
        { min: 5000, max: 900000 }
      );

    const web = (body && body.web && typeof body.web === 'object') ? body.web : null;
    const useWeb = web ? (web.enabled === true) : false;
    const webQuery = useWeb ? (safeString(web.query, 400) || truncateText(descricao, 220)) : null;
    const maxSources = useWeb ? clampInt(web.maxSources, 3, { min: 1, max: 4 }) : 0;

    if (useWeb && !cfg.enabled) {
      return next(badRequest('AI web desabilitado (AI_WEB_ENABLED=false)', 'WEB_DISABLED'));
    }

    let sources = [];
    if (useWeb) {
      let search;
      try {
        search = await webSearch(webQuery, { cfg, count: Math.min(maxSources, 6) });
      } catch (e) {
        const code = e && e.code ? String(e.code) : null;
        const msg = e && e.message ? String(e.message) : 'Falha ao buscar na web';
        if (code === 'WEB_SEARCH_NOT_CONFIGURED') {
          return next(badRequest(msg, 'WEB_SEARCH_NOT_CONFIGURED'));
        }
        return next(internalError('Falha ao buscar na web', 'WEB_SEARCH_ERROR', { error: msg }));
      }
      const urls = (search.results || []).map(r => r.url).filter(Boolean).slice(0, maxSources);

      const pages = [];
      for (const u of urls) {
        try {
          const page = await webFetchText(u, { cfg });
          pages.push({
            url: page.url,
            title: page.title || null,
            contentType: page.contentType || null,
            excerpt: truncateText(page.text || '', 1800),
          });
        } catch (e) {
          // best-effort: ignore a single source failure
        }
      }
      sources = pages;
    }

    const masterdata = await getQuestionClassificationMasterdata();
    const questionTextForMatch = [descricao, ...(alternativas || []), (correta || '')].filter(Boolean).join(' ');
    const mdTopK = clampInt(process.env.AI_CLASSIFY_MASTERDATA_TOP_K, 40, { min: 10, max: 120 });
    const masterdataForPrompt = {
      iddominiogeral: pickTopMasterdata(masterdata.iddominiogeral, questionTextForMatch, { topK: mdTopK, forceIncludeIds: [current.iddominiogeral] }),
      iddominio_desempenho: pickTopMasterdata(masterdata.iddominio_desempenho, questionTextForMatch, { topK: mdTopK, forceIncludeIds: [current.iddominio_desempenho] }),
      idprincipio: pickTopMasterdata(masterdata.idprincipio, questionTextForMatch, { topK: mdTopK, forceIncludeIds: [current.idprincipio] }),
      id_abordagem: pickTopMasterdata(masterdata.id_abordagem, questionTextForMatch, { topK: mdTopK, forceIncludeIds: [current.id_abordagem] }),
      codgrupoprocesso: pickTopMasterdata(masterdata.codgrupoprocesso, questionTextForMatch, { topK: mdTopK, forceIncludeIds: [current.codgrupoprocesso] }),
      id_task: pickTopMasterdata(masterdata.id_task, questionTextForMatch, { topK: mdTopK, forceIncludeIds: [current.id_task] }),
    };
    const allowed = {
      iddominiogeral: buildAllowedIdSet(masterdata.iddominiogeral),
      iddominio_desempenho: buildAllowedIdSet(masterdata.iddominio_desempenho),
      idprincipio: buildAllowedIdSet(masterdata.idprincipio),
      id_abordagem: buildAllowedIdSet(masterdata.id_abordagem),
      codgrupoprocesso: buildAllowedIdSet(masterdata.codgrupoprocesso),
      id_task: buildAllowedIdSet(masterdata.id_task),
    };

    const masterdataByKey = {
      iddominiogeral: masterdata.iddominiogeral,
      iddominio_desempenho: masterdata.iddominio_desempenho,
      idprincipio: masterdata.idprincipio,
      id_abordagem: masterdata.id_abordagem,
      codgrupoprocesso: masterdata.codgrupoprocesso,
      id_task: masterdata.id_task,
    };

    const system = {
      role: 'system',
      content: [
        'Você é um especialista em classificação de questões de prova (PMP/PMBOK).',
        'Responda em PT-BR.',
        'Você pode usar as "sources" como contexto adicional (quando fornecidas).',
        'O masterdata pode conter "explicacao" (quando usar aquele item); use isso para decidir com mais confiança.',
        'NUNCA invente IDs. Você só pode escolher IDs presentes no dicionário (masterdata) fornecido.',
        'Tente sempre escolher o MELHOR ID possível do masterdata com base em enunciado+alternativas.',
        'Evite suggestedId=null: sempre escolha o mais provável do masterdata, mesmo com confidence="low" quando necessário.',
        'Quando a evidência for fraca/ambígua, mantenha suggestedId (selecione o mais provável), mas marque confidence="low" e explique rapidamente o porquê.',
        'O campo "current" é apenas referência para comparar divergências; não use como viés para escolher o suggestedId.',
        `Para "context.summary", gere um resumo mais detalhado do tema/assunto (ideal 200–400 caracteres; máx ${contextSummaryMaxChars}).`,
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
        sources,
        current,
        masterdata: masterdataForPrompt,
        outputSchema: {
          context: { summary: `string (ideal 200–400 chars; máx ${contextSummaryMaxChars})`, tags: 'string[] (curtas)' },
          fields: {
            iddominiogeral: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            iddominio_desempenho: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            idprincipio: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            id_abordagem: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            codgrupoprocesso: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            id_task: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
          },
          dica: { text: 'string|null', reason: 'string' }
        },
        hardRules: {
          dicaMaxChars,
          contextSummaryMaxChars,
          noExtraKeys: true
        }
      })
    };

    const llm = await llmClient.chat({
      messages: [system, user],
      format: 'json',
      // Output is small/structured; keep generation tight to reduce runtime.
      options: { temperature: 0.1, num_predict: classifyMaxTokens },
      timeoutMs: classifyTimeoutMs,
    });

    const content = llm && llm.message && llm.message.content ? llm.message.content : '';
    const raw = String(content || '').trim();
    const parsed = tryParseJsonLenient(raw);
    if (!parsed) {
      return next(internalError('LLM retornou JSON inválido', 'AI_CLASSIFY_BAD_JSON', {
        llmProvider,
        model: llm && llm.model ? String(llm.model) : null,
        rawLen: raw.length,
        raw: raw.slice(0, 4000),
      }));
    }

    const parsedContext = (parsed && parsed.context) ? parsed.context : null;
    const out = {
      context: {
        summary: safeString(parsedContext && parsedContext.summary, contextSummaryMaxChars),
        tags: (parsedContext && Array.isArray(parsedContext.tags))
          ? parsedContext.tags.map(t => safeString(t, 50)).filter(Boolean).slice(0, 20)
          : [],
      },
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

       // Deterministic fallback: if the model returns null/invalid, pick the best match
       // using descricao+explicacao scoring. This guarantees we always return a suggestion.
      const fallbackToBestMatch = String(process.env.AI_CLASSIFY_FALLBACK_TO_BEST_MATCH || 'true').toLowerCase() === 'true';
      let bestMatchMeta = null;
      if (fallbackToBestMatch && finalSuggestedId == null) {
        const list = masterdataByKey[fieldKey] || [];
        const { best, bestScore, secondScore } = bestMasterdataMatch(list, questionTextForMatch);
        const bestId = toIntOrNull(best && best.id);
        if (bestId != null && allowed[fieldKey].has(bestId)) {
          finalSuggestedId = bestId;
          bestMatchMeta = { bestScore, secondScore, bestDescricao: best && best.descricao ? String(best.descricao) : '' };
        }
      }

      // Optional fallback: if the model returns null but a current value exists,
      // keep the current selection with low confidence (still transparent via reason).
      const fallbackToCurrent = String(process.env.AI_CLASSIFY_FALLBACK_TO_CURRENT || 'true').toLowerCase() === 'true';
      const usedFallbackToCurrent = (fallbackToCurrent && finalSuggestedId == null && currentId != null);
      if (usedFallbackToCurrent) {
        finalSuggestedId = currentId;
      }

      const differsFromCurrent = (currentId != null && finalSuggestedId != null && currentId !== finalSuggestedId);
      if (differsFromCurrent) disagreements.push({ field: fieldKey, currentId, suggestedId: finalSuggestedId });

      out.fields[fieldKey] = {
        suggestedId: finalSuggestedId,
        currentId,
        differsFromCurrent,
        confidence: (() => {
          const fromModel = (field && field.confidence) ? String(field.confidence).toLowerCase() : '';
          if (fromModel === 'low' || fromModel === 'medium' || fromModel === 'high') return fromModel;
          if (bestMatchMeta) {
            const margin = (bestMatchMeta.bestScore || 0) - (bestMatchMeta.secondScore || 0);
            if ((bestMatchMeta.bestScore || 0) >= confHighScoreMin && margin >= confHighMarginMin) return 'high';
            if ((bestMatchMeta.bestScore || 0) >= confMedScoreMin && margin >= confMedMarginMin) return 'medium';
          }
          return 'low';
        })(),
        reason: (() => {
          const fromModel = safeString(field && field.reason, 600);
          if (fromModel) return fromModel;
          if (bestMatchMeta) return 'Sugestão escolhida por melhor correspondência com enunciado/alternativas (usando masterdata + explicação).';
          if (usedFallbackToCurrent) return 'Modelo não indicou ID válido; mantido valor atual.';
          return '';
        })(),
      };
    }

    for (const k of ['iddominiogeral', 'iddominio_desempenho', 'idprincipio', 'id_abordagem', 'codgrupoprocesso', 'id_task']) {
      validateField(k);
    }

    // If the model is unsure (confidence=low), run a lightweight second pass to improve the reasons.
    // Goal: keep the same suggestedId, but cite 2–3 evidence keywords from the question/alternatives.
    const enableReasonRefine = String(process.env.AI_CLASSIFY_REFINE_LOW_REASONS || 'true').toLowerCase() === 'true';
    const isGenericReason = (s) => {
      const t = String(s || '').trim().toLowerCase();
      return (
        !t ||
        t === 'mantido valor atual por baixa confiança/ambiguidade.'.toLowerCase() ||
        t === 'modelo não indicou id com evidência suficiente; mantido valor atual.'.toLowerCase() ||
        t === 'modelo não indicou id válido; mantido valor atual.'.toLowerCase() ||
        t === 'sugestão escolhida por melhor correspondência com enunciado/alternativas (usando masterdata + explicação).'.toLowerCase()
      );
    };
    const lowKeys = enableReasonRefine
      ? ['iddominiogeral', 'iddominio_desempenho', 'idprincipio', 'id_abordagem', 'codgrupoprocesso', 'id_task']
        .filter(k => {
          const f = out.fields && out.fields[k] ? out.fields[k] : null;
          if (!f) return false;
          const confLow = String(f.confidence || '').toLowerCase() === 'low';
          return confLow || isGenericReason(f.reason);
        })
      : [];

    if (enableReasonRefine && lowKeys.length) {
      const chosen = {};

      for (const k of lowKeys) {
        const list = masterdataByKey[k];
        chosen[k] = {
          suggestedId: out.fields[k] ? out.fields[k].suggestedId : null,
          currentId: out.fields[k] ? out.fields[k].currentId : null,
          suggested: (() => {
            const it = findItemById(list, out.fields[k] ? out.fields[k].suggestedId : null);
            return it ? { id: it.id, descricao: it.descricao || '', explicacao: it.explicacao || '' } : null;
          })(),
          current: (() => {
            const it = findItemById(list, out.fields[k] ? out.fields[k].currentId : null);
            return it ? { id: it.id, descricao: it.descricao || '', explicacao: it.explicacao || '' } : null;
          })(),
        };
      }

      const system2 = {
        role: 'system',
        content: [
          'Você é um especialista em classificação de questões (PMP/PMBOK).',
          'Sua tarefa aqui é APENAS melhorar as justificativas (reason) para campos com baixa confiança.',
          'NÃO altere os suggestedId fornecidos em "chosen". Não invente IDs. Não crie chaves extras.',
          'Use também a "explicacao" do item do masterdata (quando disponível) para justificar a escolha.',
          'Para cada campo, reescreva reason citando 2–3 palavras-chave do enunciado/alternativas e 1 critério da explicacao do item (quando houver).',
          'Se não houver palavras-chave claras, diga isso explicitamente em uma frase curta.',
          'Você pode ajustar confidence para medium/high se a evidência ficar clara com a explicacao; caso contrário, mantenha low.',
          'Retorne JSON estritamente válido; sem Markdown; sem texto fora do JSON.'
        ].join(' ')
      };

      const user2 = {
        role: 'user',
        content: JSON.stringify({
          task: 'Refinar justificativas (reason) de campos com confidence=low, citando 2–3 palavras-chave como evidência.',
          question: {
            descricao,
            alternativas,
          },
          sources,
          chosen,
          outputSchema: {
            fields: {
              iddominiogeral: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
              iddominio_desempenho: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
              idprincipio: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
              id_abordagem: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
              codgrupoprocesso: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
              id_task: '{suggestedId:number|null, reason:string, confidence:low|medium|high}',
            }
          },
          hardRules: {
            doNotChangeSuggestedId: true,
            evidenceKeywordsCount: '2-3',
            maxReasonChars: Math.min(600, reasonMaxChars),
            noExtraKeys: true
          }
        })
      };

      const refineMaxTokens = (llmProvider === 'gemini')
        ? clampInt(process.env.GEMINI_CLASSIFY_JUSTIFY_MAX_TOKENS, 450, { min: 200, max: 2048 })
        : clampInt(process.env.OLLAMA_CLASSIFY_JUSTIFY_NUM_PREDICT, 280, { min: 100, max: 2048 });

      try {
        const llm2 = await llmClient.chat({
          messages: [system2, user2],
          format: 'json',
          options: { temperature: 0.1, num_predict: refineMaxTokens },
          timeoutMs: classifyTimeoutMs,
        });

        const raw2 = String((llm2 && llm2.message && llm2.message.content) ? llm2.message.content : '').trim();
        const parsed2 = tryParseJsonLenient(raw2);
        const fields2 = parsed2 && parsed2.fields ? parsed2.fields : null;
        if (fields2) {
          for (const k of lowKeys) {
            const nextReason = safeString(fields2 && fields2[k] && fields2[k].reason, 600);
            if (nextReason) out.fields[k].reason = nextReason;

            const nextConf = fields2 && fields2[k] && fields2[k].confidence ? String(fields2[k].confidence).toLowerCase() : '';
            if (nextConf === 'low' || nextConf === 'medium' || nextConf === 'high') {
              out.fields[k].confidence = nextConf;
            }
          }
        }
      } catch (e) {
        // Best-effort: keep original reasons.
      }
    }

    // Final fallback: if reason is still generic/empty, build a deterministic justification
    // based on question keywords + chosen masterdata explicacao.
    for (const k of ['iddominiogeral', 'iddominio_desempenho', 'idprincipio', 'id_abordagem', 'codgrupoprocesso', 'id_task']) {
      const f = out.fields && out.fields[k] ? out.fields[k] : null;
      if (!f) continue;
      if (!isGenericReason(f.reason)) continue;
      const list = masterdataByKey[k];
      const chosenItem = findItemById(list, f.suggestedId);
      if (!chosenItem) continue;
      const det = buildDeterministicReason({ questionText: questionTextForMatch, chosenItem, maxLen: reasonMaxChars });
      if (det) out.fields[k].reason = det;
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
        llmProvider,
        dicaMaxChars,
        dicaTruncated,
        usedWeb: Boolean(sources && sources.length),
        sourcesCount: sources.length,
        query: useWeb ? webQuery : null,
        validationIssuesCount: validationIssues.length,
        disagreementsCount: disagreements.length,
      },
      result: out,
      validationIssues,
      disagreements,
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Erro';
    try {
      // Put the root cause into the message so it shows in the dev console format.
      logger.error(`AI classify failed: ${msg}`, {
        requestId: req.id,
        url: req.originalUrl,
        method: req.method,
        error: msg,
        code: err && err.code ? String(err.code) : null,
        stack: err && err.stack ? String(err.stack) : null,
      });
    } catch (_) {}

    if (err && err.code === 'TABLE_MISSING_COLUMNS') {
      return next(internalError('Masterdata inválido para classificação', 'TABLE_MISSING_COLUMNS', err.meta || { error: msg }));
    }

    // Common LLM/network failures should be easier to spot.
    const provider = llmClient.getProvider();
    if (/\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b/i.test(msg) || /fetch failed/i.test(msg) || /timeout/i.test(msg) || /ollama/i.test(msg) || /gemini/i.test(msg)) {
      if (provider === 'gemini') {
        return next(internalError('Falha ao chamar Gemini', 'GEMINI_ERROR', { error: msg }));
      }
      return next(internalError('Falha ao chamar Ollama', 'OLLAMA_ERROR', { error: msg }));
    }

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
