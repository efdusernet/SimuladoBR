const { logger } = require('../utils/logger');

function getEnv(name, fallback) {
  const v = process.env[name];
  return (v == null || String(v).trim() === '') ? fallback : String(v).trim();
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
  } finally {
    clearTimeout(timeout);
  }
}

async function chat({ model, messages, format = undefined, options = undefined }) {
  if (!globalThis.fetch) {
    throw new Error('Fetch API não disponível no Node. Use Node 18+ ou adicione um polyfill.');
  }

  const baseUrl = getEnv('OLLAMA_URL', 'http://localhost:11434');
  const finalModel = model || getEnv('OLLAMA_MODEL', 'llama3.1');
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;

  const body = {
    model: finalModel,
    messages,
    stream: false,
  };
  if (format) body.format = format;
  if (options) body.options = options;

  const timeoutMs = Number(getEnv('OLLAMA_TIMEOUT_MS', '20000'));

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, Number.isFinite(timeoutMs) ? timeoutMs : 20000);

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

  const system = {
    role: 'system',
    content: [
      'Você é um assistente de estudo para certificação (PMP/CPM/CAPM).',
      'Use APENAS os dados fornecidos.',
      'Não invente números nem eventos.',
      'Responda em PT-BR.',
      'Retorne JSON estritamente válido no formato pedido.'
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
        headline: 'string curta',
        insights: ['lista de strings (3-6)'],
        risks: ['lista de strings (0-4)'],
        actions7d: ['lista de ações objetivas (3-7)'],
        focusAreas: [
          {
            area: 'string',
            reason: 'string',
            priority: 'alta|media|baixa'
          }
        ]
      }
    })
  };

  try {
    const resp = await chat({ messages: [system, user], format: 'json' });
    const content = resp && resp.message && resp.message.content ? resp.message.content : '';
    const parsed = JSON.parse(content);
    return { usedOllama: true, insights: parsed, model: resp.model || null };
  } catch (err) {
    logger.warn('Falha ao gerar insights via Ollama; usando fallback', { error: err.message });
    return { usedOllama: false, insights: null };
  }
}

module.exports = {
  isEnabled,
  chat,
  generateJsonInsights,
};
