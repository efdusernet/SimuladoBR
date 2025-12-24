const { logger } = require('../utils/logger');

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

function tryParseJsonLenient(text) {
  const cleaned = stripCodeFences(text);
  const candidates = [];
  if (cleaned) candidates.push(cleaned);

  const firstObj = cleaned.indexOf('{');
  const lastObj = cleaned.lastIndexOf('}');
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    candidates.push(cleaned.slice(firstObj, lastObj + 1));
  }

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
  const envTimeoutMs = getEnvInt('OLLAMA_TIMEOUT_MS', 60000, { min: 5000, max: 300000 });
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

async function generateJsonInsights({ context, kpis, timeseries }) {
  if (!isEnabled()) {
    return { usedOllama: false, insights: null };
  }

  const insightsTimeoutMs = getEnvInt(
    'OLLAMA_INSIGHTS_TIMEOUT_MS',
    getEnvInt('OLLAMA_TIMEOUT_MS', 60000, { min: 5000, max: 300000 }),
    { min: 5000, max: 300000 }
  );

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
      options: { num_predict: 160, temperature: 0.1 },
    });
    const content = resp && resp.message && resp.message.content ? resp.message.content : '';
    const parsed = tryParseJsonLenient(content);
    if (!parsed) {
      throw new Error('Resposta do Ollama não é JSON válido');
    }
    return { usedOllama: true, insights: parsed, model: resp.model || null };
  } catch (err) {
    logger.warn(`Falha ao gerar insights via Ollama; usando fallback (${err.message})`, { error: err.message });
    return { usedOllama: false, insights: null };
  }
}

module.exports = {
  isEnabled,
  chat,
  generateJsonInsights,
};
