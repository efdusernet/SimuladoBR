require('dotenv').config();

const { listModels } = require('../services/geminiClient');

(async () => {
  console.log('list_gemini_models: start');
  console.log(
    JSON.stringify(
      {
        GEMINI_API_BASE: process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta',
        GEMINI_MODEL: process.env.GEMINI_MODEL || null,
        GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS || null,
        hasKey: Boolean(process.env.GEMINI_API_KEY),
      },
      null,
      2
    )
  );

  const models = await listModels();
  const simplified = models
    .map((m) => ({
      name: m && m.name ? String(m.name) : null,
      displayName: m && m.displayName ? String(m.displayName) : null,
      supportedGenerationMethods: Array.isArray(m && m.supportedGenerationMethods) ? m.supportedGenerationMethods : [],
    }))
    .filter((m) => m.name);

  console.log(JSON.stringify({ count: simplified.length, models: simplified }, null, 2));
  console.log('list_gemini_models: end');
})().catch((err) => {
  console.error('ERR', err && err.message ? err.message : err);
  process.exit(1);
});
