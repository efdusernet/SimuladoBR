const ollama = require('./ollamaClient');
const gemini = require('./geminiClient');

function getProvider() {
  const explicit = String(process.env.LLM_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;

  // If Gemini is configured, prefer it by default.
  // This keeps "no-config" dev behavior (falls back to Ollama) while making
  // Gemini work out-of-the-box when GEMINI_API_KEY is present.
  if (gemini.isEnabled()) return 'gemini';

  return 'ollama';
}

function isEnabled() {
  const provider = getProvider();
  if (provider === 'gemini') return gemini.isEnabled();
  // default
  return String(process.env.OLLAMA_ENABLED || '').toLowerCase() === 'true';
}

async function chat(args) {
  const provider = getProvider();
  if (provider === 'gemini') return gemini.chat(args);
  return ollama.chat(args);
}

async function generateJsonInsights(args) {
  const provider = getProvider();

  if (provider === 'gemini') {
    const r = await gemini.generateJsonInsights(args);
    return {
      ...r,
      llmProvider: 'gemini',
      usedLlm: Boolean(r.usedLlm),
      // legacy compatibility
      usedOllama: false,
    };
  }

  const r = await ollama.generateJsonInsights(args);
  return {
    ...r,
    llmProvider: 'ollama',
    usedLlm: Boolean(r.usedOllama),
  };
}

module.exports = {
  getProvider,
  isEnabled,
  chat,
  generateJsonInsights,
};
