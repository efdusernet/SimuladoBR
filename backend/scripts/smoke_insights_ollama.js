require('dotenv').config();

const { generateJsonInsights, getProvider } = require('../services/llmClient');

(async () => {
  console.log('smoke_insights_ollama: start');
  console.log(
    JSON.stringify(
      {
        LLM_PROVIDER: getProvider(),
        OLLAMA_ENABLED: process.env.OLLAMA_ENABLED,
        OLLAMA_URL: process.env.OLLAMA_URL,
        OLLAMA_MODEL: process.env.OLLAMA_MODEL,
        OLLAMA_TIMEOUT_MS: process.env.OLLAMA_TIMEOUT_MS,
        OLLAMA_INSIGHTS_TIMEOUT_MS: process.env.OLLAMA_INSIGHTS_TIMEOUT_MS,
        GEMINI_MODEL: process.env.GEMINI_MODEL,
        GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS,
        GEMINI_INSIGHTS_TIMEOUT_MS: process.env.GEMINI_INSIGHTS_TIMEOUT_MS,
      },
      null,
      2
    )
  );

  const t0 = Date.now();
  const result = await generateJsonInsights({
    context: { app: 'SimuladosBR', smoke: true },
    kpis: {
      avgScorePercent: 70,
      completionRate: 0.8,
      abandonRate: 0.1,
      readinessScore: 75,
      consistencyScore: 50,
      days: 30,
      trendDeltaScore7d: 1,
    },
    timeseries: [],
  });

  console.log(
    JSON.stringify(
      {
        llmProvider: result.llmProvider || null,
        usedLlm: result.usedLlm,
        usedOllama: result.usedOllama,
        model: result.model || null,
        ms: Date.now() - t0,
        hasInsights: Boolean(result.insights),
      },
      null,
      2
    )
  );

  console.log('smoke_insights_ollama: end');
})().catch((err) => {
  console.error('ERR', err && err.message ? err.message : err);
  process.exit(1);
});
