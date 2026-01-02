const { env } = require('../config/env');

function isEnabled() {
  return Boolean(env.GEMINI_API_KEY);
}

function normalizeModelName(model) {
  const s = String(model || '').trim();
  if (!s) return s;
  return s.startsWith('models/') ? s.slice('models/'.length) : s;
}

function getApiBaseUrl() {
  return String(env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
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

async function chat({ model, messages, format = undefined, options = undefined, timeoutMs = undefined }) {
  if (!globalThis.fetch) {
    throw new Error('Fetch API não disponível no Node. Use Node 18+ ou adicione um polyfill.');
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    const e = new Error('GEMINI_API_KEY não configurada');
    e.code = 'GEMINI_NOT_CONFIGURED';
    throw e;
  }

  const finalModel = normalizeModelName(model || env.GEMINI_MODEL || 'gemini-1.5-flash');
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/models/${encodeURIComponent(finalModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const { systemInstruction, contents } = mapMessagesToGemini({ messages });

  const generationConfig = {};
  if (format === 'json') generationConfig.responseMimeType = 'application/json';
  if (options && Number.isFinite(Number(options.temperature))) generationConfig.temperature = Number(options.temperature);

  const body = {
    contents,
    generationConfig: Object.keys(generationConfig).length ? generationConfig : undefined,
    systemInstruction: systemInstruction || undefined,
  };

  const effectiveTimeoutMs = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : env.GEMINI_TIMEOUT_MS;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, effectiveTimeoutMs);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${text || res.statusText}`);
  }

  const json = await res.json();
  const candidate = (json && Array.isArray(json.candidates) && json.candidates[0]) ? json.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts.map(p => (p && p.text != null ? String(p.text) : '')).join('') || '';

  return {
    model: finalModel,
    message: {
      role: 'assistant',
      content: text,
    }
  };
}

module.exports = {
  isEnabled,
  chat,
};
