const { logger } = require('../utils/logger');

let UndiciAgent = null;
try {
  // Node's built-in fetch is powered by undici and supports the `dispatcher` option.
  // Using an Agent lets us control headers/body timeouts that otherwise can fire
  // before our AbortController timeout.
  // eslint-disable-next-line global-require
  ({ Agent: UndiciAgent } = require('undici'));
} catch {
  UndiciAgent = null;
}

const dispatcherCache = new Map();

function getUndiciTimeouts(timeoutMs) {
  const t = Number(timeoutMs);
  const base = Number.isFinite(t) ? t : 20000;
  // Add a small cushion so undici doesn't win the race against our AbortController.
  const cushionMs = 5000;
  const headersTimeoutMs = Math.max(5000, base + cushionMs);
  const bodyTimeoutMs = Math.max(5000, base + cushionMs);
  return { headersTimeoutMs, bodyTimeoutMs };
}

function getUndiciDispatcher(timeoutMs) {
  if (!UndiciAgent) return null;
  const { headersTimeoutMs, bodyTimeoutMs } = getUndiciTimeouts(timeoutMs);
  const key = `${headersTimeoutMs}:${bodyTimeoutMs}`;
  if (dispatcherCache.has(key)) return dispatcherCache.get(key);
  const dispatcher = new UndiciAgent({ headersTimeout: headersTimeoutMs, bodyTimeout: bodyTimeoutMs });
  dispatcherCache.set(key, dispatcher);
  return dispatcher;
}

function getEnv(name, fallback) {
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

function stripCodeFences(text) {
  const s = String(text || '').trim();
  // ```json ... ``` or ``` ... ```
  return s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractFirstJsonValue(text) {
  const s = String(text || '');
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const start = (firstObj === -1)
    ? firstArr
    : (firstArr === -1 ? firstObj : Math.min(firstObj, firstArr));
  if (start === -1) return null;

  const stack = [];
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      const last = stack[stack.length - 1];
      const matches = (last === '{' && ch === '}') || (last === '[' && ch === ']');
      if (matches) stack.pop();
      if (stack.length === 0) {
        return s.slice(start, i + 1);
      }
    }
  }

  return null;
}

function tryParseJsonLenient(text) {
  const cleaned = stripCodeFences(text).replace(/^\uFEFF/, '');
  const candidates = [];
  if (cleaned) candidates.push(cleaned);

  const extracted = extractFirstJsonValue(cleaned);
  if (extracted) candidates.push(extracted);

  for (const cand of candidates) {
    // 1) strict parse
    try {
      return JSON.parse(cand);
    } catch {}

    // 2) common fix: remove trailing commas
    try {
      const noTrailingCommas = cand.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(noTrailingCommas);
    } catch {}
  }

  return null;
}

function isEnabled() {
  return String(process.env.OLLAMA_ENABLED || '').toLowerCase() === 'true';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetchOptions = { ...options, signal: controller.signal };
    if (!fetchOptions.dispatcher) {
      const dispatcher = getUndiciDispatcher(timeoutMs);
      if (dispatcher) fetchOptions.dispatcher = dispatcher;
    }
    const res = await fetch(url, fetchOptions);
    return res;
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    const name = err && err.name ? String(err.name) : '';
    if (name === 'AbortError' || /aborted/i.test(msg)) {
      const e = new Error(`Timeout após ${timeoutMs}ms`);
      e.cause = err;
      throw e;
    }

    // Undici-specific timeouts can fire before AbortController if not configured.
    try {
      const code = err && err.code ? String(err.code) : (err && err.cause && err.cause.code ? String(err.cause.code) : null);
      if (code === 'UND_ERR_HEADERS_TIMEOUT') {
        const { headersTimeoutMs } = getUndiciTimeouts(timeoutMs);
        const e = new Error(`Timeout ao aguardar headers do Ollama (undici) após ~${headersTimeoutMs}ms`);
        e.cause = err;
        throw e;
      }
      if (code === 'UND_ERR_BODY_TIMEOUT') {
        const { bodyTimeoutMs } = getUndiciTimeouts(timeoutMs);
        const e = new Error(`Timeout ao receber body do Ollama (undici) após ~${bodyTimeoutMs}ms`);
        e.cause = err;
        throw e;
      }
    } catch (e) {
      if (e && e.message && e.message !== msg) throw e;
    }

    // Enrich typical Node/undici network failures (e.g. ECONNREFUSED)
    try {
      const cause = err && err.cause ? err.cause : null;
      const code = cause && cause.code ? String(cause.code) : (err && err.code ? String(err.code) : null);
      const causeMsg = cause && cause.message ? String(cause.message) : null;
      const extra = [code, causeMsg].filter(Boolean).join(' - ');
      if (extra) {
        const e = new Error(`${msg || 'fetch failed'} (${extra})`);
        e.cause = err;
        throw e;
      }
    } catch (e) {
      if (e && e.message && e.message !== msg) throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function chat({ model, messages, format = undefined, options = undefined, timeoutMs = undefined }) {
  if (!globalThis.fetch) {
    throw new Error('Fetch API não disponível no Node. Use Node 18+ ou adicione um polyfill.');
  }

  const baseUrl = getEnv('OLLAMA_URL', 'http://localhost:11434');
  // Prefer an explicit tag by default because many local installs have tagged models (e.g. llama3.1:8b)
  const finalModel = model || getEnv('OLLAMA_MODEL', 'llama3.1:8b');
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;

  const body = {
    model: finalModel,
    messages,
    stream: false,
  };
  if (format) body.format = format;
  if (options) body.options = options;

  // Local inference can be slow on some machines; keep this conservative but practical.
  const envTimeoutMs = getEnvInt('OLLAMA_TIMEOUT_MS', 60000, { min: 5000, max: 900000 });
  const effectiveTimeoutMs = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : envTimeoutMs;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, Number.isFinite(effectiveTimeoutMs) ? effectiveTimeoutMs : 20000);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${text || res.statusText}`);
  }

  return res.json();
}

async function generateJsonInsights({ context, kpis, timeseries, indicators = undefined }) {
  if (!isEnabled()) {
    return { usedOllama: false, insights: null, insightsTimeoutMs: null };
  }

  const insightsTimeoutMs = getEnvInt(
    'OLLAMA_INSIGHTS_TIMEOUT_MS',
    getEnvInt('OLLAMA_TIMEOUT_MS', 60000, { min: 5000, max: 900000 }),
    { min: 5000, max: 900000 }
  );

  const debugTimeouts = {
    env: {
      OLLAMA_TIMEOUT_MS: process.env.OLLAMA_TIMEOUT_MS || null,
      OLLAMA_INSIGHTS_TIMEOUT_MS: process.env.OLLAMA_INSIGHTS_TIMEOUT_MS || null,
      OLLAMA_URL: process.env.OLLAMA_URL || null,
      OLLAMA_MODEL: process.env.OLLAMA_MODEL || null,
    },
    computed: {
      insightsTimeoutMs,
      undici: getUndiciTimeouts(insightsTimeoutMs),
    },
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
      // Keep Insights snappy: prefer quick fallback over long waits.
      timeoutMs: insightsTimeoutMs,
      options: { num_predict: 240, temperature: 0.1 },
    });
    const content = resp && resp.message && resp.message.content ? resp.message.content : '';
    const parsed = tryParseJsonLenient(content);
    if (!parsed) {
      throw new Error('Resposta do Ollama não é JSON válido');
    }
    return { usedOllama: true, insights: parsed, model: resp.model || null, insightsTimeoutMs, debugTimeouts };
  } catch (err) {
    logger.warn(`Falha ao gerar insights via Ollama; usando fallback (${err.message})`, { error: err.message });
    return { usedOllama: false, insights: null, insightsTimeoutMs, debugTimeouts, error: err && err.message ? String(err.message) : 'Erro' };
  }
}

module.exports = {
  isEnabled,
  chat,
  generateJsonInsights,
};
