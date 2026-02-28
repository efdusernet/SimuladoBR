const gemini = require('./geminiClient');

function getProvider() {
  const explicit = String(process.env.LLM_PROVIDER || '').trim().toLowerCase();
  // Gemini-only: keep the env var for compatibility, but only accept gemini.
  if (explicit && explicit !== 'gemini') return 'gemini';
  return 'gemini';
}

function isEnabled() {
  return gemini.isEnabled();
}

async function chat(args) {
  return gemini.chat(args);
}

async function generateJsonInsights(args) {
  const r = await gemini.generateJsonInsights(args);
  return {
    ...r,
    llmProvider: 'gemini',
    usedLlm: Boolean(r.usedLlm),
  };
}

module.exports = {
  getProvider,
  isEnabled,
  chat,
  generateJsonInsights,
};
