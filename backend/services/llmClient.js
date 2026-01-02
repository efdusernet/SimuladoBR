const ollama = require('./ollamaClient');
const gemini = require('./geminiClient');

function getProvider() {
  return String(process.env.LLM_PROVIDER || 'ollama').trim().toLowerCase();
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
