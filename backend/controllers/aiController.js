const db = require('../models');
const { badRequest, internalError } = require('../middleware/errors');
const buildUserStatsService = require('../services/UserStatsService');
const { generateJsonInsights, generateJsonLiteratureSuggestions } = require('../services/ollamaClient');

function clampDays(v, def = 30) {
  let days = Number(v);
  if (!Number.isFinite(days) || days <= 0) days = def;
  return Math.min(Math.max(Math.floor(days), 1), 180);
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function computeTrend(last, prev) {
  if (!last.length || !prev.length) return null;
  const avg = (arr) => {
    const vals = arr.map(r => r.avgScorePercent).filter(v => v != null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const a = avg(last);
  const b = avg(prev);
  if (a == null || b == null) return null;
  return a - b;
}

function buildFallbackInsights({ kpis, trendDelta }) {
  const insights = [];
  const risks = [];
  const actions7d = [];
  const focusAreas = [];

  const avgScore = kpis.avgScorePercent;
  const completionPct = kpis.completionRate * 100;
  const abandonPct = kpis.abandonRate * 100;

  if (avgScore == null) {
    insights.push('Ainda não há score médio suficiente para análise; finalize mais simulados para melhorar os insights.');
  } else if (avgScore >= 80) {
    insights.push('Seu score médio recente está forte. O foco agora é consistência e reduzir oscilações.');
  } else if (avgScore >= 70) {
    insights.push('Você está próximo do patamar de aprovação. Pequenos ajustes e revisão dirigida podem destravar a evolução.');
  } else {
    insights.push('Seu score médio recente indica que vale priorizar revisão estruturada antes de aumentar volume de simulados completos.');
  }

  if (trendDelta != null) {
    if (trendDelta > 1.5) insights.push('Tendência positiva nas últimas semanas: seu score está subindo.');
    else if (trendDelta < -1.5) risks.push('Tendência negativa recente: seu score caiu vs. a semana anterior.');
    else insights.push('Seu desempenho está relativamente estável nas últimas semanas.');
  }

  if (completionPct < 60) risks.push('Baixa taxa de conclusão: muitos simulados iniciados não são finalizados.');
  if (abandonPct > 25) risks.push('Taxa de abandono alta: pode estar faltando estratégia de ritmo (tempo) ou ambiente de prova.');

  actions7d.push('Faça 2 sessões de revisão de erros (30–45 min) antes do próximo simulado.');
  actions7d.push('Faça 1 simulado (quiz ou parcial) focado em tempo e leitura cuidadosa.');
  actions7d.push('Finalize 1 simulado completo ou um conjunto maior, priorizando concluir sem interromper.');
  actions7d.push('Revise os 10 erros mais repetidos e escreva 1 regra/heurística por erro.');

  if (avgScore != null && avgScore < 75) {
    focusAreas.push({ area: 'Revisão dirigida', reason: 'Aumentar base conceitual e reduzir erro recorrente', priority: 'alta' });
  }
  if (completionPct < 60) {
    focusAreas.push({ area: 'Consistência', reason: 'Aumentar taxa de conclusão para gerar histórico confiável', priority: 'alta' });
  }

  return {
    headline: 'Insights do seu desempenho recente',
    insights,
    risks,
    actions7d,
    focusAreas,
  };
}

async function getInsightsDashboard(req, res, next) {
  try {
    const days = clampDays(req.query.days, 30);

    const userId = req.user && req.user.id ? Number(req.user.id) : null;
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

    const userStatsService = buildUserStatsService(db);
    const [summary, daily] = await Promise.all([
      userStatsService.getSummary(userId, days),
      userStatsService.getDailyStats(userId, days),
    ]);

    const series = (daily || []).map(r => ({
      date: r.date,
      avgScorePercent: r.avgScorePercent,
      completionRate: r.completionRate,
      abandonRate: r.abandonRate,
      started: r.started,
      finished: r.finished,
    }));

    const last7 = series.slice(-7);
    const prev7 = series.slice(-14, -7);
    const trendDelta = computeTrend(last7, prev7);

    const daysWithActivity = series.filter(r => (r.started || 0) > 0 || (r.finished || 0) > 0).length;
    const consistencyScore = series.length ? Math.round((daysWithActivity / series.length) * 100) : 0;

    const avgScore = summary.avgScorePercent == null ? null : safeNumber(summary.avgScorePercent, null);
    const completionRate = safeNumber(summary.completionRate, 0);
    const abandonRate = safeNumber(summary.abandonRate, 0);

    const readinessScore = Math.max(0, Math.min(100, Math.round(
      (avgScore == null ? 0 : avgScore) * 0.7 + (completionRate * 100) * 0.3
    )));

    const kpis = {
      days,
      readinessScore,
      consistencyScore,
      avgScorePercent: avgScore,
      completionRate,
      abandonRate,
      trendDeltaScore7d: trendDelta,
    };

    const context = {
      app: 'SimuladosBR',
      userId,
      periodDays: days,
      note: 'Dados agregados por dia; não inclui texto das questões.'
    };

    const ollama = await generateJsonInsights({ context, kpis, timeseries: series });
    const ai = ollama.insights || buildFallbackInsights({ kpis, trendDelta });

    return res.json({
      success: true,
      meta: {
        generatedAt: new Date().toISOString(),
        usedOllama: ollama.usedOllama,
        model: ollama.model || null,
      },
      kpis,
      timeseries: series,
      ai,
    });
  } catch (err) {
    return next(internalError('Erro interno', 'AI_INSIGHTS_ERROR', err));
  }
}

module.exports = {
  getInsightsDashboard,
  getLiteratureSuggestions,
};

function parseEcoYear(code) {
  const m = String(code || '').match(/(20\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
}

function buildFallbackLiterature({ ecoCode }) {
  const year = parseEcoYear(ecoCode);
  const pmbokEdition = year == null ? 'edição mais recente' : (year >= 2021 ? '7ª edição' : '6ª edição');

  return {
    headline: 'Literaturas sugeridas (alinhadas ao seu ECO)',
    pt: [
      { title: `Guia PMBOK® (${pmbokEdition}) — versão em português`, note: 'Base principal do conteúdo de referência; alinhe a edição ao seu ECO.' },
      { title: 'Guia de Prática Ágil (Agile Practice Guide) — PMI', note: 'Complemento importante para cenários híbridos/ágeis que aparecem com frequência.' },
      { title: 'Process Groups: A Practice Guide — PMI', note: 'Apoia a visão de processos e integração, útil para consolidar entendimento.' },
      { title: 'Preparatório PMP (Rita Mulcahy) — edição compatível com o ECO', note: 'Livro de preparação com abordagem prática e foco em prova.' },
      { title: 'Simulados + revisão de erros (seu histórico no SimuladosBR)', note: 'Use como literatura “ativa”: refaça erros e consolide heurísticas.' },
    ],
    en: [
      { title: `PMBOK® Guide (${pmbokEdition}) — English`, note: 'Primary reference; keep the edition consistent with your ECO.' },
      { title: 'Agile Practice Guide — PMI', note: 'High-impact complement for agile/hybrid situations.' },
      { title: 'Process Groups: A Practice Guide — PMI', note: 'Helps reinforce process/group understanding and integration.' },
      { title: 'PMP Exam Prep (Rita Mulcahy) — compatible edition', note: 'Practical exam-oriented prep and mindset.' },
      { title: 'PMI Lexicon of Project Management Terms (online)', note: 'Terminology reference to reduce ambiguity when reading questions.' },
    ]
  };
}

async function resolveEffectiveEcoForUser({ userId, examTypeSlug }) {
  const slug = String(examTypeSlug || 'pmp').trim().toLowerCase();
  const examType = await db.ExamType.findOne({ where: { Slug: slug } });
  if (!examType) return { examType: null, eco: null };
  const examTypeId = Number(examType.Id);
  const sequelize = db.sequelize;
  let examContentVersionId = null;
  let source = null;

  // 1) Override per user
  try {
    const rows = await sequelize.query(
      `SELECT uecv.exam_content_version_id AS id
         FROM user_exam_content_version uecv
        WHERE uecv.user_id = :uid
          AND uecv.exam_type_id = :examTypeId
          AND uecv.active = TRUE
          AND (uecv.starts_at IS NULL OR uecv.starts_at <= NOW())
          AND (uecv.ends_at IS NULL OR uecv.ends_at > NOW())
        ORDER BY uecv.id DESC
        LIMIT 1`,
      { replacements: { uid: Number(userId), examTypeId }, type: sequelize.QueryTypes.SELECT }
    );
    if (Array.isArray(rows) && rows[0] && rows[0].id != null) {
      const n = Number(rows[0].id);
      if (Number.isFinite(n) && n > 0) { examContentVersionId = n; source = 'override'; }
    }
  } catch (_) { /* ignore */ }

  // 2) Current/default
  if (!examContentVersionId) {
    try {
      const rows = await sequelize.query(
        `SELECT exam_content_version_id AS id
           FROM exam_content_current_version
          WHERE exam_type_id = :examTypeId
          LIMIT 1`,
        { replacements: { examTypeId }, type: sequelize.QueryTypes.SELECT }
      );
      if (Array.isArray(rows) && rows[0] && rows[0].id != null) {
        const n = Number(rows[0].id);
        if (Number.isFinite(n) && n > 0) { examContentVersionId = n; source = 'current'; }
      }
    } catch (_) { /* ignore */ }
  }

  // 3) Latest
  if (!examContentVersionId) {
    try {
      const rows = await sequelize.query(
        `SELECT id
           FROM exam_content_version
          WHERE exam_type_id = :examTypeId
          ORDER BY effective_from DESC NULLS LAST, id DESC
          LIMIT 1`,
        { replacements: { examTypeId }, type: sequelize.QueryTypes.SELECT }
      );
      if (Array.isArray(rows) && rows[0] && rows[0].id != null) {
        const n = Number(rows[0].id);
        if (Number.isFinite(n) && n > 0) { examContentVersionId = n; source = 'latest'; }
      }
    } catch (_) { /* ignore */ }
  }

  if (!examContentVersionId) {
    return { examType: { id: examTypeId, slug, nome: examType.Nome || null }, eco: { source: null, examContentVersionId: null, code: null } };
  }

  let code = null;
  try {
    const rows = await sequelize.query(
      `SELECT code
         FROM exam_content_version
        WHERE id = :id
        LIMIT 1`,
      { replacements: { id: examContentVersionId }, type: sequelize.QueryTypes.SELECT }
    );
    if (Array.isArray(rows) && rows[0]) code = rows[0].code || null;
  } catch (_) { /* ignore */ }

  return {
    examType: { id: examTypeId, slug, nome: examType.Nome || null },
    eco: { source, examContentVersionId, code }
  };
}

async function getLiteratureSuggestions(req, res, next) {
  try {
    const userId = req.user && req.user.id ? Number(req.user.id) : null;
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

    const examTypeSlug = String(req.query.examTypeSlug || 'pmp').trim().toLowerCase();
    const resolved = await resolveEffectiveEcoForUser({ userId, examTypeSlug });
    if (!resolved.examType) return next(badRequest('Tipo de exame inválido', 'EXAM_TYPE_INVALID'));

    const ecoCode = resolved.eco && resolved.eco.code ? String(resolved.eco.code) : '';
    const context = {
      app: 'SimuladosBR',
      userId,
      examType: resolved.examType,
      eco: resolved.eco,
      note: 'Sugestões de literatura devem ser alinhadas ao ECO efetivo do usuário.'
    };

    const ollama = await generateJsonLiteratureSuggestions({ context, eco: resolved.eco, examType: resolved.examType });
    const suggestions = ollama.suggestions || buildFallbackLiterature({ ecoCode });

    return res.json({
      success: true,
      meta: {
        generatedAt: new Date().toISOString(),
        usedOllama: ollama.usedOllama,
        model: ollama.model || null,
      },
      examType: resolved.examType,
      eco: resolved.eco,
      suggestions,
    });
  } catch (err) {
    return next(internalError('Erro interno', 'AI_LITERATURE_ERROR', err));
  }
}
