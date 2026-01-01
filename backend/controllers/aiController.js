const db = require('../models');
const { badRequest, internalError } = require('../middleware/errors');
const buildUserStatsService = require('../services/UserStatsService');
const { generateJsonInsights } = require('../services/llmClient');
const indicatorController = require('./indicatorController');

function pickTopBottom(items, { valueKey, labelKey, topN = 5, bottomN = 5 }) {
  const list = Array.isArray(items) ? items : [];
  const normalized = list
    .map((it) => {
      const value = it && it[valueKey] != null ? Number(it[valueKey]) : null;
      if (value == null || !Number.isFinite(value)) return null;
      const label = it && it[labelKey] != null ? String(it[labelKey]) : '';
      return { label, value };
    })
    .filter(Boolean);

  const sortedAsc = normalized.slice().sort((a, b) => a.value - b.value);
  const sortedDesc = normalized.slice().sort((a, b) => b.value - a.value);

  return {
    weakest: sortedAsc.slice(0, Math.max(0, bottomN)),
    strongest: sortedDesc.slice(0, Math.max(0, topN)),
  };
}

async function runIndicator(controllerFn, { query = {}, user = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { query, user };
    const res = { json: (data) => resolve(data) };
    const next = (err) => (err ? reject(err) : resolve(null));
    Promise.resolve(controllerFn(req, res, next)).catch(reject);
  });
}

async function safeRunIndicator(name, controllerFn, opts) {
  const t0 = Date.now();
  try {
    const data = await runIndicator(controllerFn, opts);
    return { ok: true, name, data, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Erro desconhecido';
    const code = err && err.code ? String(err.code) : null;
    return { ok: false, name, error: msg, code, ms: Date.now() - t0 };
  }
}

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

function parseBrazilianDateToLocalMidnight(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const s10 = raw.length >= 10 ? raw.slice(0, 10) : raw;
  const m = s10.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy)) return null;
  const dt = new Date(yyyy, mm - 1, dd);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== (mm - 1) || dt.getDate() !== dd) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function getLocalMidnightNow() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function addUnique(list, item) {
  const arr = Array.isArray(list) ? list : [];
  if (!item) return arr;
  const s = String(item).trim();
  if (!s) return arr;
  const norm = (x) => String(x || '').trim().toLowerCase();
  const seen = new Set(arr.map(norm));
  if (seen.has(norm(s))) return arr;
  return [...arr, s];
}

function buildKpiCommentary({ kpis, examInfo }) {
  const parts = [];
  const completionPct = Math.round((Number(kpis.completionRate || 0) * 100) * 10) / 10;
  if (Number.isFinite(completionPct)) {
    if (completionPct >= 80) {
      parts.push(`Taxa de conclusão de ${completionPct}%: ótimo sinal — você está finalizando a maioria dos simulados iniciados, o que gera um histórico confiável.`);
    } else if (completionPct >= 50) {
      parts.push(`Taxa de conclusão de ${completionPct}%: razoável, mas ainda há espaço para melhorar consistência (finalizar o que começa).`);
    } else {
      parts.push(`Taxa de conclusão de ${completionPct}%: baixa — isso significa que muitos simulados iniciados não são finalizados, o que prejudica a consolidação e a leitura real do seu nível.`);
    }
  }

  const avg = kpis.avgScorePercent;
  if (avg != null && Number.isFinite(Number(avg))) {
    const a = Math.round(Number(avg) * 10) / 10;
    if (a >= 80) parts.push(`Score médio de ${a}%: forte; foque em reduzir variação e manter consistência.`);
    else if (a >= 70) parts.push(`Score médio de ${a}%: perto do patamar de aprovação; revisão dirigida pode destravar os pontos finais.`);
    else parts.push(`Score médio de ${a}%: sugere reforçar base e revisar erros antes de priorizar volume.`);
  }

  if (examInfo && examInfo.examDateRaw && examInfo.daysToExam != null && examInfo.daysToExam >= 0) {
    parts.push(`Sua data prevista de exame está em ${examInfo.daysToExam} dia(s) (${examInfo.examDateRaw}).`);
  }

  return parts.join(' ');
}

function enrichAiWithRules(ai, { kpis, examInfo }) {
  const out = ai && typeof ai === 'object' ? { ...ai } : {};
  out.insights = Array.isArray(out.insights) ? out.insights.slice() : [];
  out.risks = Array.isArray(out.risks) ? out.risks.slice() : [];
  out.actions7d = Array.isArray(out.actions7d) ? out.actions7d.slice() : [];

  const completionPct = Number(kpis.completionRate || 0) * 100;
  const completionPct1 = Math.round(completionPct * 10) / 10;
  const examSoon = examInfo && examInfo.daysToExam != null && examInfo.daysToExam >= 0 && examInfo.daysToExam < 75;

  // Comentário útil sobre os números (evita ficar só "o número")
  const commentary = buildKpiCommentary({ kpis, examInfo });
  if (commentary) {
    const hasKpiComment = out.insights.some(s => /taxa de conclus|score m[ée]dio|data prevista de exame/i.test(String(s || '')));
    if (!hasKpiComment) out.insights = addUnique(out.insights, commentary);
  }

  // Alertas: baixa conclusão deve aparecer como risco
  if (completionPct < 60) {
    out.risks = addUnique(out.risks, `Baixa taxa de conclusão (${completionPct1}%): priorize finalizar os simulados iniciados para ganhar consistência e dados confiáveis.`);
  }

  // Prazo curto: se houver qualquer risco, explicitar que o deadline aumenta a criticidade
  if (examSoon && Array.isArray(out.risks) && out.risks.length > 0 && examInfo && examInfo.examDateRaw) {
    out.risks = addUnique(
      out.risks,
      `Prazo curto: seu exame está em ~${examInfo.daysToExam} dia(s) (${examInfo.examDateRaw}). Trate os alertas acima como prioritários para não comprometer o deadline.`
    );
  }

  // Deadline: se exame em <= 2 meses + conclusão muito baixa => risco de prazo
  if (examSoon && completionPct < 30) {
    out.risks = addUnique(
      out.risks,
      `Risco de prazo: seu exame está em ~${examInfo.daysToExam} dia(s) (${examInfo.examDateRaw}) e sua taxa de conclusão está em ${completionPct1}%. Nesse ritmo, há risco de não consolidar o conhecimento a tempo.`
    );
  }

  // Ação sugerida: meta de taxa de conclusão
  let target = Math.round(Math.min(90, Math.max(30, completionPct + 20)));
  if (examSoon) target = Math.round(Math.min(90, Math.max(target, 50)));
  if (target > Math.round(completionPct)) {
    out.actions7d = addUnique(out.actions7d, `Aumentar taxa de conclusão para ${target}% (próximos 7 dias).`);
  }

  return out;
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

    // Pull indicators so the AI can explicitly consider the indicator framework.
    // Rules per user request:
    // - IND10 uses examMode=best
    // - IND4/IND5/IND6 use exam_type=2
    const indicatorUser = { ...req.user, id: userId, sub: String(userId) };
    const examTypeId456 = 2;
    const ind10MaxExams = 50;
    const indicatorJobs = [
      safeRunIndicator('IND1', indicatorController.getExamsCompleted, { query: { days: String(days), idUsuario: String(userId) }, user: indicatorUser }),
      safeRunIndicator('IND2', indicatorController.getApprovalRate, { query: { days: String(days), idUsuario: String(userId) }, user: indicatorUser }),
      safeRunIndicator('IND3', indicatorController.getFailureRate, { query: { days: String(days), idUsuario: String(userId) }, user: indicatorUser }),
      safeRunIndicator('IND4', indicatorController.getQuestionsCount, { query: { exam_type: String(examTypeId456) }, user: indicatorUser }),
      safeRunIndicator('IND5', indicatorController.getAnsweredQuestionsCount, { query: { exam_type: String(examTypeId456), idUsuario: String(userId) }, user: indicatorUser }),
      safeRunIndicator('IND6', indicatorController.getTotalHours, { query: { exam_type: String(examTypeId456), idUsuario: String(userId) }, user: indicatorUser }),
      safeRunIndicator('IND7', indicatorController.getProcessGroupStats, { query: { idUsuario: String(userId) }, user: indicatorUser }),
      safeRunIndicator('IND9', indicatorController.getAbordagemStats, { query: { idUsuario: String(userId) }, user: indicatorUser }),
      safeRunIndicator('IND10', indicatorController.getPerformancePorDominio, { query: { examMode: 'best', idUsuario: String(userId), max_exams: String(ind10MaxExams) }, user: indicatorUser }),
      safeRunIndicator('IND11', indicatorController.getAvgTimePerQuestion, { query: { days: String(days), idUsuario: String(userId), exam_mode: 'full' }, user: indicatorUser }),
      safeRunIndicator('IND12', indicatorController.getPerformancePorDominioAgregado, { query: { idUsuario: String(userId) }, user: indicatorUser }),
    ];

    const indicatorResults = await Promise.all(indicatorJobs);
    const indicators = indicatorResults.reduce((acc, r) => {
      acc[r.name] = r.ok ? r.data : null;
      return acc;
    }, {});
    const indicatorErrors = indicatorResults.filter(r => !r.ok).map(r => ({ indicator: r.name, error: r.error, code: r.code || null }));
    const indicatorTimings = indicatorResults.map(r => ({ indicator: r.name, ok: r.ok, ms: r.ms }));

    const userStatsService = buildUserStatsService(db);
    const [summary, daily, userRow] = await Promise.all([
      userStatsService.getSummary(userId, days),
      userStatsService.getDailyStats(userId, days),
      db.User ? db.User.findByPk(userId, { attributes: ['DataExame'] }) : Promise.resolve(null),
    ]);

    const series = (daily || []).map(r => ({
      date: r.date,
      avgScorePercent: r.avgScorePercent,
      completionRate: r.completionRate,
      abandonRate: r.abandonRate,
      started: r.started,
      finished: r.finished,
    }));

    // Keep the AI prompt compact (Ollama can time out with large payloads)
    const timeseriesForAi = series.slice(-14).map(r => ({
      date: r.date,
      avgScorePercent: r.avgScorePercent,
      completionRate: r.completionRate,
      abandonRate: r.abandonRate,
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

    const examDateRaw = userRow && userRow.DataExame ? String(userRow.DataExame) : null;
    const examDateLocal = parseBrazilianDateToLocalMidnight(examDateRaw);
    const todayLocal = getLocalMidnightNow();
    const daysToExam = examDateLocal ? Math.round((examDateLocal.getTime() - todayLocal.getTime()) / (24 * 60 * 60 * 1000)) : null;
    const examInfo = {
      examDateRaw: examDateRaw || null,
      daysToExam: Number.isFinite(daysToExam) ? daysToExam : null,
    };

    const context = {
      app: 'SimuladosBR',
      userId,
      periodDays: days,
      examDate: examInfo.examDateRaw,
      daysToExam: examInfo.daysToExam,
      note: 'Dados agregados por dia; inclui indicadores IND1..IND7 e IND9..IND12 (valores resumidos); não inclui texto das questões.',
      indicatorParams: {
        ind10ExamMode: 'best',
        ind456ExamTypeId: examTypeId456,
      },
    };

    const indicatorsSummary = {
      IND1: { totalExams: indicators.IND1?.total ?? null, days },
      IND2: { approvalRatePercent: indicators.IND2?.ratePercent ?? null, total: indicators.IND2?.total ?? null },
      IND3: { failureRatePercent: indicators.IND3?.ratePercent ?? null, total: indicators.IND3?.total ?? null },
      IND4: { questionsAvailable: indicators.IND4?.total ?? null, examTypeId: examTypeId456 },
      IND5: {
        answeredDistinctActive: indicators.IND5?.activeDistinct ?? null,
        answeredDistinctHistorical: indicators.IND5?.historicalDistinct ?? null,
        examTypeId: examTypeId456,
      },
      IND6: { totalHours: indicators.IND6?.horas ?? null, examTypeId: examTypeId456 },
      IND7: pickTopBottom(indicators.IND7?.grupos, { valueKey: 'percentAcertos', labelKey: 'descricao', topN: 5, bottomN: 5 }),
      IND9: pickTopBottom(indicators.IND9?.abordagens, { valueKey: 'percentAcertos', labelKey: 'descricao', topN: 5, bottomN: 5 }),
      IND10: pickTopBottom(indicators.IND10?.domains, { valueKey: 'percentage', labelKey: 'name', topN: 5, bottomN: 5 }),
      IND11: {
        avgSeconds: indicators.IND11?.avgSeconds ?? null,
        avgMinutes: indicators.IND11?.avgMinutes ?? null,
        totalQuestions: indicators.IND11?.totalQuestions ?? null,
        days,
      },
      IND12: pickTopBottom(indicators.IND12?.dominios, { valueKey: 'percent', labelKey: 'descricao', topN: 5, bottomN: 5 }),
    };

    const llm = await generateJsonInsights({ context, kpis, timeseries: timeseriesForAi, indicators: indicatorsSummary });
    const baseAi = llm.insights || buildFallbackInsights({ kpis, trendDelta });
    const ai = enrichAiWithRules(baseAi, { kpis, examInfo });

    return res.json({
      success: true,
      meta: {
        generatedAt: new Date().toISOString(),
        usedOllama: Boolean(llm.usedOllama),
        usedLlm: Boolean(llm.usedLlm),
        llmProvider: llm.llmProvider || null,
        model: llm.model || null,
        ...(process.env.NODE_ENV === 'development' ? {
          llmInsightsTimeoutMs: llm.insightsTimeoutMs ?? null,
          llmTimeoutEnv: (llm.debugTimeouts && llm.debugTimeouts.env) ? llm.debugTimeouts.env : null,
          llmTimeoutComputed: (llm.debugTimeouts && llm.debugTimeouts.computed) ? llm.debugTimeouts.computed : null,
          llmError: llm.usedLlm ? null : (llm.error || null),
          ind10MaxExams,
          indicatorTimings,
        } : {}),
        ...(process.env.NODE_ENV === 'development' && indicatorErrors.length ? { indicatorErrors } : {}),
      },
      kpis,
      timeseries: series,
      indicators,
      indicatorsSummary,
      ai,
    });
  } catch (err) {
    return next(internalError('Erro interno', 'AI_INSIGHTS_ERROR', err));
  }
}

module.exports = {
  getInsightsDashboard,
};
