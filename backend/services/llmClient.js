const gemini = require('./geminiClient');

function getProvider() {
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
