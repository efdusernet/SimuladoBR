const ollama = require('./ollamaClient');
const gemini = require('./geminiClient');
const { env } = require('../config/env');

function getProvider() {
  return String(env.LLM_PROVIDER || 'ollama').trim().toLowerCase();
}

function isEnabled() {
  const provider = getProvider();
  if (provider === 'gemini') return gemini.isEnabled();
  return Boolean(env.OLLAMA_ENABLED);
}

async function chat(args) {
  const provider = getProvider();
  if (provider === 'gemini') return gemini.chat(args);
  return ollama.chat(args);
}

module.exports = {
  getProvider,
  isEnabled,
  chat,
};
