const { env } = require('../config/env');

function getEnv(name, fallback) {
  const v = process.env[name];
  return (v == null || String(v).trim() === '') ? fallback : String(v).trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
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

function isEnabled() {
  return Boolean(env.OLLAMA_ENABLED);
}

async function chat({ model, messages, format = undefined, options = undefined, timeoutMs = undefined }) {
  if (!globalThis.fetch) {
    throw new Error('Fetch API não disponível no Node. Use Node 18+ ou adicione um polyfill.');
  }

  const baseUrl = getEnv('OLLAMA_URL', env.OLLAMA_URL || 'http://localhost:11434');
  const finalModel = model || env.OLLAMA_MODEL || 'llama3.1:8b';
  const url = `${String(baseUrl).replace(/\/+$/, '')}/api/chat`;

  const body = {
    model: finalModel,
    messages,
    stream: false,
  };
  if (format) body.format = format;
  if (options) body.options = options;

  const effectiveTimeoutMs = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : env.OLLAMA_TIMEOUT_MS;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, effectiveTimeoutMs);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${text || res.statusText}`);
  }

  return res.json();
}

module.exports = {
  isEnabled,
  chat,
};
