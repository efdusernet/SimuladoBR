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

module.exports = {
  getProvider,
  isEnabled,
  chat,
};
