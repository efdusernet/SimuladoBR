const { logger } = require('../utils/logger');
const { tryParseJsonLenient } = require('../utils/jsonParseLenient');

function getEnv(name, fallback = '') {
  const v = process.env[name];
  return (v == null || String(v).trim() === '') ? fallback : String(v).trim();
}

function getEnvInt(name, fallback, { min = undefined, max = undefined } = {}) {
  const raw = getEnv(name, String(fallback));
  const n = Number(raw);
  if (!Number.isFinite(n)) return Number(fallback);
  if (Number.isFinite(min) && n < min) return Number(fallback);
  if (Number.isFinite(max) && n > max) return Number(fallback);
  return Math.floor(n);
}

function isEnabled() {
  return Boolean(getEnv('GEMINI_API_KEY', ''));
}

function getApiBaseUrl() {
  // Allow overriding in case Google changes defaults or the user needs a specific API version.
  // Examples:
  // - https://generativelanguage.googleapis.com/v1beta
  // - https://generativelanguage.googleapis.com/v1
  const raw = getEnv('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com/v1beta');
  return raw.replace(/\/+$/, '');
}

function normalizeModelName(model) {
  const s = String(model || '').trim();
  if (!s) return s;
  // Accept either "gemini-..." or "models/gemini-..."
  return s.startsWith('models/') ? s.slice('models/'.length) : s;
}

function mapMessagesToGemini({ messages }) {
  const systemParts = [];
  const contents = [];

  for (const m of (messages || [])) {
    const role = m && m.role ? String(m.role) : 'user';
    const content = (m && m.content != null) ? String(m.content) : '';
    if (!content) continue;

    if (role === 'system') {
      systemParts.push(content);
      continue;
    }

    const geminiRole = (role === 'assistant') ? 'model' : 'user';
    contents.push({ role: geminiRole, parts: [{ text: content }] });
  }

  const systemInstruction = systemParts.length
    ? { parts: [{ text: systemParts.join('\n') }] }
    : null;

  return { systemInstruction, contents };
}


async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    const name = err && err.name ? String(err.name) : '';
    if (name === 'AbortError' || /aborted/i.test(msg)) {
      const e = new Error(`Timeout após ${timeoutMs}ms`);
      e.cause = err;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function extractApiError(jsonOrText) {
  if (!jsonOrText) return null;
  if (typeof jsonOrText === 'string') return jsonOrText;
  const err = jsonOrText && jsonOrText.error ? jsonOrText.error : null;
  if (!err) return null;
  const code = err.code != null ? String(err.code) : '';
  const status = err.status != null ? String(err.status) : '';
  const msg = err.message != null ? String(err.message) : '';
  return [code, status, msg].filter(Boolean).join(' - ');
}

function shouldRetryWithV1({ baseUrl, status, message }) {
  const base = String(baseUrl || '');
  const msg = String(message || '');
  if (status !== 404) return false;
  if (!/\/v1beta\b/i.test(base)) return false;
  // Google's error is explicit about API version mismatch.
  return /API version v1beta/i.test(msg) || /not supported for generateContent/i.test(msg) || /is not found/i.test(msg);
}

function buildGenerateContentUrl(baseUrl, modelName, apiKey) {
  const m = normalizeModelName(modelName);
  return `${baseUrl}/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

async function chat({ model, messages, format = undefined, options = undefined, timeoutMs = undefined }) {
  if (!globalThis.fetch) {
    throw new Error('Fetch API não disponível no Node. Use Node 18+ ou adicione um polyfill.');
  }

  const apiKey = getEnv('GEMINI_API_KEY', '');
  if (!apiKey) {
    const e = new Error('GEMINI_API_KEY não configurada');
    e.code = 'GEMINI_NOT_CONFIGURED';
    throw e;
  }

  // Good default for speed/price; user can override.
  const finalModel = normalizeModelName(model || getEnv('GEMINI_MODEL', 'gemini-1.5-flash'));
  const baseUrl = getApiBaseUrl();
  const url = buildGenerateContentUrl(baseUrl, finalModel, apiKey);

  const envTimeoutMs = getEnvInt('GEMINI_TIMEOUT_MS', 60000, { min: 5000, max: 900000 });
  const effectiveTimeoutMs = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : envTimeoutMs;

  const { systemInstruction, contents } = mapMessagesToGemini({ messages });

  const temperature = options && Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : undefined;
  const maxOutputTokens = options && Number.isFinite(Number(options.num_predict)) ? Math.floor(Number(options.num_predict)) : undefined;

  const generationConfig = {};
  if (temperature != null) generationConfig.temperature = temperature;
  if (maxOutputTokens != null) generationConfig.maxOutputTokens = maxOutputTokens;
  if (format === 'json') {
    // Best-effort: Gemini supports response MIME type in generationConfig for many models.
    generationConfig.responseMimeType = 'application/json';
  }

  const body = {
    contents,
    generationConfig: Object.keys(generationConfig).length ? generationConfig : undefined,
    systemInstruction: systemInstruction || undefined,
  };

  const requestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };

  let res = await fetchWithTimeout(url, requestInit, effectiveTimeoutMs);
  if (!res.ok) {
    const jsonErr = await tryReadJson(res);
    const textErr = jsonErr ? null : await res.text().catch(() => '');
    const errMsg = extractApiError(jsonErr) || textErr || res.statusText;

    if (shouldRetryWithV1({ baseUrl, status: res.status, message: errMsg })) {
      const v1Base = baseUrl.replace(/\/v1beta\b/i, '/v1');
      const v1Url = buildGenerateContentUrl(v1Base, finalModel, apiKey);
      const res2 = await fetchWithTimeout(v1Url, requestInit, effectiveTimeoutMs);
      if (!res2.ok) {
        const jsonErr2 = await tryReadJson(res2);
        const textErr2 = jsonErr2 ? null : await res2.text().catch(() => '');
        const errMsg2 = extractApiError(jsonErr2) || textErr2 || res2.statusText;
        throw new Error(
          `Gemini HTTP ${res2.status}: ${errMsg2}. ` +
          `Dica: rode "node backend/scripts/list_gemini_models.js" e ajuste GEMINI_MODEL para um modelo que suporte generateContent.`
        );
      }
      res = res2;
    } else {
      throw new Error(
        `Gemini HTTP ${res.status}: ${errMsg}. ` +
        `Dica: rode "node backend/scripts/list_gemini_models.js" e ajuste GEMINI_MODEL.`
      );
    }
  }

  const json = await res.json();
  const candidate = (json && Array.isArray(json.candidates) && json.candidates[0]) ? json.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts.map(p => (p && p.text != null ? String(p.text) : '')).join('') || '';

  // Match Ollama's response shape used by controllers.
  return {
    model: finalModel,
    message: {
      role: 'assistant',
      content: text,
    }
  };
}

async function listModels({ includeAll = false } = {}) {
  if (!globalThis.fetch) {
    throw new Error('Fetch API não disponível no Node. Use Node 18+ ou adicione um polyfill.');
  }

  const apiKey = getEnv('GEMINI_API_KEY', '');
  if (!apiKey) {
    const e = new Error('GEMINI_API_KEY não configurada');
    e.code = 'GEMINI_NOT_CONFIGURED';
    throw e;
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`;

  const timeoutMs = getEnvInt('GEMINI_TIMEOUT_MS', 60000, { min: 5000, max: 900000 });
  const res = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
  if (!res.ok) {
    const jsonErr = await tryReadJson(res);
    const textErr = jsonErr ? null : await res.text().catch(() => '');
    const errMsg = extractApiError(jsonErr) || textErr || res.statusText;
    throw new Error(`Gemini listModels HTTP ${res.status}: ${errMsg}`);
  }

  const json = await res.json();
  const models = Array.isArray(json && json.models) ? json.models : [];
  if (includeAll) return models;

  // Best-effort: filter models that appear to support generateContent.
  return models.filter((m) => {
    const methods = Array.isArray(m && m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
    return methods.includes('generateContent');
  });
}

async function generateJsonInsights({ context, kpis, timeseries, indicators = undefined }) {
  if (!isEnabled()) {
    return { usedLlm: false, insights: null, insightsTimeoutMs: null };
  }

  const insightsTimeoutMs = getEnvInt(
    'GEMINI_INSIGHTS_TIMEOUT_MS',
    getEnvInt('GEMINI_TIMEOUT_MS', 60000, { min: 5000, max: 900000 }),
    { min: 5000, max: 900000 }
  );

  const debugTimeouts = {
    env: {
      GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS || null,
      GEMINI_INSIGHTS_TIMEOUT_MS: process.env.GEMINI_INSIGHTS_TIMEOUT_MS || null,
      GEMINI_MODEL: process.env.GEMINI_MODEL || null,
    },
    computed: { insightsTimeoutMs },
  };

  const system = {
    role: 'system',
    content: [
      'Você é um assistente de estudo para certificação (PMP/CPM/CAPM).',
      'Use APENAS os dados fornecidos.',
      'Não invente números nem eventos.',
      'Responda em PT-BR.',
      'Retorne JSON estritamente válido no formato pedido.',
      'Seja MUITO conciso: evite explicações longas.',
      'Não use Markdown, não use texto fora do JSON.'
    ].join(' ')
  };

  const user = {
    role: 'user',
    content: JSON.stringify({
      task: 'Gerar insights e recomendações a partir de métricas do usuário',
      context,
      kpis,
      timeseries,
      indicators,
      outputSchema: {
        headline: 'string curta (<= 90 chars)',
        insights: 'array 3-5 strings (<= 120 chars cada)',
        risks: 'array 0-3 strings (<= 120 chars cada)',
        actions7d: 'array 3-5 ações (<= 120 chars cada)',
        focusAreas: 'array 2-4 itens {area, reason, priority: alta|media|baixa} (strings curtas)'
      },
      hardLimits: {
        maxTotalChars: 1800,
        noExtraKeys: true
      }
    })
  };

  try {
    const resp = await chat({
      messages: [system, user],
      format: 'json',
      timeoutMs: insightsTimeoutMs,
      options: { num_predict: 240, temperature: 0.1 },
    });

    const content = resp && resp.message && resp.message.content ? resp.message.content : '';
    const parsed = tryParseJsonLenient(content);
    if (!parsed) throw new Error('Resposta do Gemini não é JSON válido');

    return { usedLlm: true, insights: parsed, model: resp.model || null, insightsTimeoutMs, debugTimeouts };
  } catch (err) {
    logger.warn(`Falha ao gerar insights via Gemini; usando fallback (${err.message})`, { error: err.message });
    return { usedLlm: false, insights: null, insightsTimeoutMs, debugTimeouts, error: err && err.message ? String(err.message) : 'Erro' };
  }
}

module.exports = {
  isEnabled,
  chat,
  listModels,
  generateJsonInsights,
};
