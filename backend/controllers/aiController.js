const db = require('../models');
const { badRequest, internalError } = require('../middleware/errors');
const buildUserStatsService = require('../services/UserStatsService');
const { generateJsonInsights } = require('../services/llmClient');
const indicatorController = require('./indicatorController');
const { logger } = require('../utils/logger');

function formatLocalYmd(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

function computePassProbabilityFromInd12(ind12) {
  // Mirrors frontend logic (Indicadores -> Probabilidade de Sucesso)
  // overallPercent = (Σ acertos / Σ total) × 100
  // probabilityPercent = clamp((overallPercent / 75) × 100, 0, 100)
  const PASS_THRESHOLD = 75;
  const dominios = ind12 && Array.isArray(ind12.dominios) ? ind12.dominios : [];
  if (!dominios.length) return { overallPercent: null, probabilityPercent: null, passThreshold: PASS_THRESHOLD };

  const totals = dominios.reduce(
    (acc, d) => {
      acc.total += Number(d && d.total) || 0;
      acc.acertos += Number(d && d.acertos) || 0;
      return acc;
    },
    { total: 0, acertos: 0 }
  );
  if (!totals.total) return { overallPercent: null, probabilityPercent: null, passThreshold: PASS_THRESHOLD };

  const overallPercent = Number(((totals.acertos / totals.total) * 100).toFixed(2));
  const probabilityPercent = Number(((overallPercent / PASS_THRESHOLD) * 100).toFixed(0));

  return {
    overallPercent,
    probabilityPercent: clamp(probabilityPercent, 0, 100),
    passThreshold: PASS_THRESHOLD,
  };
}

function buildTaskPlanFromInd13(ind13, { daysToExam } = {}) {
  const src = ind13 && Array.isArray(ind13.tasks) ? ind13.tasks : [];
  const candidates = src
    .map(t => {
      const impact = t && t.impactScore != null ? Number(t.impactScore) : null;
      const dominioId = t && t.dominioId != null ? Number(t.dominioId) : null;
      return {
        id: t && t.id != null ? Number(t.id) : null,
        descricao: t && t.descricao != null ? String(t.descricao) : '—',
        dominioId: Number.isFinite(dominioId) ? dominioId : null,
        peso: t && t.peso != null ? Number(t.peso) : null,
        percent: t && t.percent != null ? Number(t.percent) : null,
        impactScore: Number.isFinite(impact) ? impact : null,
        total: t && t.total != null ? Number(t.total) : null,
      };
    })
    .filter(t => t.id != null && t.impactScore != null)
    .sort((a, b) => b.impactScore - a.impactScore);

  const planDays = 7;
  const tasksPerDay = (daysToExam != null && Number.isFinite(daysToExam) && daysToExam >= 0 && daysToExam <= 30) ? 3 : 2;
  const maxTasks = planDays * tasksPerDay;
  if (!candidates.length) {
    return {
      days: planDays,
      tasksPerDay,
      items: [],
      note: 'Sem Tasks suficientes (com peso e amostra mínima) para gerar plano.'
    };
  }

  // Round-robin by domain to diversify focus
  const buckets = new Map();
  for (const t of candidates) {
    const key = t.dominioId != null ? String(t.dominioId) : 'none';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  const bucketKeys = Array.from(buckets.keys());
  let idx = 0;
  const picked = [];
  const seen = new Set();
  while (picked.length < maxTasks) {
    if (!bucketKeys.length) break;
    let tries = 0;
    let added = false;
    while (tries < bucketKeys.length) {
      const key = bucketKeys[idx % bucketKeys.length];
      idx++;
      tries++;
      const list = buckets.get(key);
      while (list && list.length) {
        const next = list.shift();
        if (!next || next.id == null) continue;
        if (seen.has(next.id)) continue;
        seen.add(next.id);
        picked.push(next);
        added = true;
        break;
      }
      if (added) break;
    }
    if (!added) break;
  }

  const items = [];
  for (let d = 0; d < planDays; d++) {
    const slice = picked.slice(d * tasksPerDay, (d + 1) * tasksPerDay);
    if (!slice.length) break;
    items.push({
      dayIndex: d + 1,
      title: `Dia ${d + 1}`,
      tasks: slice,
      checklist: [
        'Revisar teoria/resumo da(s) Task(s)',
        'Fazer 10–15 questões focadas (ou 1 bloco no simulado)',
        'Revisar erros e anotar 3 “regras” do que errou'
      ]
    });
  }

  return {
    days: planDays,
    tasksPerDay,
    items,
    note: 'Plano sugerido com base em impacto (peso × gap para 100%) e desempenho recente.'
  };
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

  if (kpis && kpis.passProbabilityPercent != null && Number.isFinite(Number(kpis.passProbabilityPercent))) {
    const p = Math.round(Number(kpis.passProbabilityPercent));
    const overall = (kpis.passProbabilityOverallPercent != null && Number.isFinite(Number(kpis.passProbabilityOverallPercent)))
      ? Math.round(Number(kpis.passProbabilityOverallPercent) * 10) / 10
      : null;
    const extra = overall != null ? ` (média geral ${overall}%)` : '';
    if (p >= 85) parts.push(`Probabilidade de aprovação estimada: ${p}%${extra} — muito boa.`);
    else if (p >= 75) parts.push(`Probabilidade de aprovação estimada: ${p}%${extra} — no patamar de corte.`);
    else if (p >= 60) parts.push(`Probabilidade de aprovação estimada: ${p}%${extra} — abaixo do patamar; revisão dirigida deve destravar.`);
    else parts.push(`Probabilidade de aprovação estimada: ${p}%${extra} — baixa; foque nas fraquezas com maior peso antes do exame.`);
  }

  return parts.join(' ');
}

function pct1(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function buildExplainabilityForRiskMessage(message, { kpis, examInfo } = {}) {
  const msg = String(message || '').trim();
  if (!msg) return null;

  const rules = {
    passThresholdPercent: 75,
    examSoonDays: 90,
    riskHighDays: 30,
    completionLowPercent: 60,
    completionVeryLowPercent: 30,
    abandonHighPercent: 25,
    trendDeltaNegativeThreshold: -1.5,
  };

  const basedOn = [];

  const daysToExam = examInfo && examInfo.daysToExam != null && Number.isFinite(examInfo.daysToExam) ? examInfo.daysToExam : null;
  const examDateRaw = examInfo && examInfo.examDateRaw ? String(examInfo.examDateRaw) : null;
  const completionRate = kpis && kpis.completionRate != null ? Number(kpis.completionRate) : null;
  const abandonRate = kpis && kpis.abandonRate != null ? Number(kpis.abandonRate) : null;
  const trendDelta = kpis && kpis.trendDeltaScore7d != null ? Number(kpis.trendDeltaScore7d) : null;
  const passProb = kpis && kpis.passProbabilityPercent != null ? Number(kpis.passProbabilityPercent) : null;
  const passOverall = kpis && kpis.passProbabilityOverallPercent != null ? Number(kpis.passProbabilityOverallPercent) : null;

  const add = (entry) => { if (entry) basedOn.push(entry); };

  if (/\bIND12\b|probabilidade de aprova/i.test(msg) || /^Risco\b|^Risco alto\b/i.test(msg)) {
    add({
      source: 'IND12',
      metric: 'passProbabilityPercent',
      label: 'Probabilidade de aprovação estimada',
      value: Number.isFinite(passProb) ? pct1(passProb) : null,
      threshold: rules.passThresholdPercent,
      unit: '%',
      details: 'Derivado do desempenho agregado por domínio (IND12).',
    });
    add({
      source: 'IND12',
      metric: 'passProbabilityOverallPercent',
      label: 'Média geral (acertos/total)',
      value: Number.isFinite(passOverall) ? pct1(passOverall) : null,
      unit: '%',
    });
  }

  if (/prazo cr[ií]tico|exame est[aá] em|Risco de prazo/i.test(msg)) {
    add({
      source: 'Usuario.data_exame',
      metric: 'daysToExam',
      label: 'Dias até o exame',
      value: daysToExam,
      threshold: rules.examSoonDays,
      unit: 'dias',
      details: examDateRaw ? `Data cadastrada: ${examDateRaw}` : null,
    });
  }

  if (/Baixa taxa de conclus/i.test(msg) || /Risco de prazo/i.test(msg)) {
    const pct = Number.isFinite(completionRate) ? pct1(completionRate * 100) : null;
    add({
      source: 'KPIs',
      metric: 'completionRate',
      label: 'Taxa de conclusão',
      value: pct,
      threshold: rules.completionLowPercent,
      unit: '%',
      details: 'Concluídos / iniciados no período (resumo).',
    });
  }

  if (/abandono/i.test(msg)) {
    const pct = Number.isFinite(abandonRate) ? pct1(abandonRate * 100) : null;
    add({
      source: 'KPIs',
      metric: 'abandonRate',
      label: 'Taxa de abandono',
      value: pct,
      threshold: rules.abandonHighPercent,
      unit: '%',
      details: 'Abandonados / iniciados no período (resumo).',
    });
  }

  if (/Tend[êe]ncia negativa/i.test(msg)) {
    add({
      source: 'Timeseries',
      metric: 'trendDeltaScore7d',
      label: 'Tendência (média últimos 7d − 7d anteriores)',
      value: Number.isFinite(trendDelta) ? pct1(trendDelta) : null,
      threshold: rules.trendDeltaNegativeThreshold,
      unit: 'pp',
      details: 'Calculado a partir da série diária de score médio.',
    });
  }

  // Severity (UI can use this to highlight)
  let severity = 'alert';
  if (/^Risco alto\b/i.test(msg)) severity = 'high';
  else if (/^Risco de prazo\b/i.test(msg)) severity = 'high';
  else if (/^Risco\b/i.test(msg)) severity = 'medium';
  else if (/^Prazo cr[ií]tico\b/i.test(msg)) severity = 'info';

  return {
    message: msg,
    severity,
    basedOn,
    rules,
  };
}

function attachExplainability(ai, { kpis, examInfo } = {}) {
  const out = ai && typeof ai === 'object' ? { ...ai } : {};
  const risks = Array.isArray(out.risks) ? out.risks : [];
  const alerts = [];
  let mergedRules = null;

  for (const r of risks) {
    const a = buildExplainabilityForRiskMessage(r, { kpis, examInfo });
    if (!a) continue;
    if (a.rules && !mergedRules) mergedRules = a.rules;
    alerts.push({ message: a.message, severity: a.severity, basedOn: a.basedOn });
  }

  out.explainability = {
    generatedAt: new Date().toISOString(),
    rules: mergedRules || {
      passThresholdPercent: 75,
      examSoonDays: 90,
      riskHighDays: 30,
      completionLowPercent: 60,
      completionVeryLowPercent: 30,
      abandonHighPercent: 25,
      trendDeltaNegativeThreshold: -1.5,
    },
    alerts,
  };

  return out;
}

function enrichAiWithRules(ai, { kpis, examInfo }) {
  const out = ai && typeof ai === 'object' ? { ...ai } : {};
  out.insights = Array.isArray(out.insights) ? out.insights.slice() : [];
  out.risks = Array.isArray(out.risks) ? out.risks.slice() : [];
  out.actions7d = Array.isArray(out.actions7d) ? out.actions7d.slice() : [];

  const completionPct = Number(kpis.completionRate || 0) * 100;
  const completionPct1 = Math.round(completionPct * 10) / 10;
  const daysToExam = examInfo && examInfo.daysToExam != null && Number.isFinite(examInfo.daysToExam) ? examInfo.daysToExam : null;
  const examSoon = daysToExam != null && daysToExam >= 0 && daysToExam <= 90;
  const examVerySoon = daysToExam != null && daysToExam >= 0 && daysToExam <= 90;
  const passProb = (kpis && kpis.passProbabilityPercent != null) ? Number(kpis.passProbabilityPercent) : null;
  const passProb1 = (passProb != null && Number.isFinite(passProb)) ? Math.round(passProb * 10) / 10 : null;

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

  // Risco por prazo + probabilidade de aprovação baixa
  if (examVerySoon && passProb1 != null && passProb1 < 75) {
    const severity = daysToExam != null && daysToExam <= 30 ? 'Risco alto' : 'Risco';
    out.risks = addUnique(
      out.risks,
      `${severity}: seu exame está em ~${daysToExam} dia(s) (${examInfo.examDateRaw || 'data cadastrada'}) e sua probabilidade de aprovação estimada está em ${passProb1}%. Com o prazo crítico (≤90 dias), priorize revisão dirigida nas maiores fraquezas e simulados completos finalizados.`
    );
    out.actions7d = addUnique(out.actions7d, 'Priorizar 2 ciclos: (1) revisar erros recorrentes, (2) simulado completo + correção detalhada.');
  }

  // Prazo crítico (<= 90 dias): se houver qualquer risco, explicitar que o deadline aumenta a criticidade
  if (examSoon && Array.isArray(out.risks) && out.risks.length > 0 && examInfo && examInfo.examDateRaw) {
    out.risks = addUnique(
      out.risks,
      `Prazo crítico: seu exame está em ~${examInfo.daysToExam} dia(s) (${examInfo.examDateRaw}). Trate os alertas acima como prioritários para não comprometer o deadline.`
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

    const ind13MinTotalRaw = parseInt(req.query.ind13_min_total, 10);
    const ind13MinTotal = Number.isFinite(ind13MinTotalRaw) ? Math.min(Math.max(ind13MinTotalRaw, 1), 200) : null;
    const ind13DominioIdRaw = parseInt(req.query.ind13_dominio_id, 10);
    const ind13DominioId = Number.isFinite(ind13DominioIdRaw) && ind13DominioIdRaw > 0 ? ind13DominioIdRaw : null;

    const ind13Query = {
      idUsuario: String(userId),
      ...(ind13MinTotal != null ? { min_total: String(ind13MinTotal) } : {}),
      ...(ind13DominioId != null ? { dominio_id: String(ind13DominioId) } : {}),
    };

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
      safeRunIndicator('IND13', indicatorController.getPerformancePorTaskAgregado, { query: ind13Query, user: indicatorUser }),
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
      db.User ? db.User.findByPk(userId, { attributes: ['DataExame', 'BloqueioAtivado'] }) : Promise.resolve(null),
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

    const passProb = computePassProbabilityFromInd12(indicators.IND12);

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
      passProbabilityPercent: passProb.probabilityPercent,
      passProbabilityOverallPercent: passProb.overallPercent,
      passProbabilityThresholdPercent: passProb.passThreshold,
    };

    const examDateRaw = userRow && userRow.DataExame ? String(userRow.DataExame) : null;
    const examDateLocal = parseBrazilianDateToLocalMidnight(examDateRaw);
    const todayLocal = getLocalMidnightNow();
    const daysToExam = examDateLocal ? Math.round((examDateLocal.getTime() - todayLocal.getTime()) / (24 * 60 * 60 * 1000)) : null;
    const examInfo = {
      examDateRaw: examDateRaw || null,
      daysToExam: Number.isFinite(daysToExam) ? daysToExam : null,
    };

    const taskPlan = buildTaskPlanFromInd13(indicators.IND13, { daysToExam: examInfo.daysToExam });

    const context = {
      app: 'SimuladosBR',
      userId,
      periodDays: days,
      examDate: examInfo.examDateRaw,
      daysToExam: examInfo.daysToExam,
      note: 'Dados agregados por dia; inclui indicadores IND1..IND7 e IND9..IND13 (valores resumidos); não inclui texto das questões.',
      indicatorParams: {
        ind10ExamMode: 'best',
        ind456ExamTypeId: examTypeId456,
        ind13MinTotal: ind13MinTotal != null ? ind13MinTotal : null,
        ind13DominioId: ind13DominioId != null ? ind13DominioId : null,
      },
      studyPlan: {
        days: taskPlan.days,
        tasksPerDay: taskPlan.tasksPerDay,
        // Keep prompt compact: only top tasks labels
        topTasks: (taskPlan.items || []).flatMap(it => (it.tasks || []).map(t => t.descricao)).slice(0, 10)
      }
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
      IND13: pickTopBottom(indicators.IND13?.tasks, { valueKey: 'percent', labelKey: 'descricao', topN: 5, bottomN: 5 }),
      PASS: {
        probabilityPercent: passProb.probabilityPercent,
        overallPercent: passProb.overallPercent,
        thresholdPercent: passProb.passThreshold,
      },
    };

    const llm = await generateJsonInsights({ context, kpis, timeseries: timeseriesForAi, indicators: indicatorsSummary });
    const baseAi = llm.insights || buildFallbackInsights({ kpis, trendDelta });
    const ai = attachExplainability(enrichAiWithRules(baseAi, { kpis, examInfo }), { kpis, examInfo });

    // If no LLM, still present the plan as a concrete next step
    if (!llm.usedLlm && taskPlan && Array.isArray(taskPlan.items) && taskPlan.items.length) {
      ai.actions7d = addUnique(ai.actions7d, 'Siga o “Plano de 7 dias (Tasks)” abaixo para atacar as prioridades por impacto.');
    }

    // Record a daily snapshot for paying users only (Usuario.BloqueioAtivado === false).
    // This is the groundwork for a real temporal risk model.
    try {
      const isPaying = Boolean(userRow) && userRow.BloqueioAtivado === false;
      if (isPaying && db && db.sequelize) {
        const snapshotDate = formatLocalYmd(getLocalMidnightNow());
        if (snapshotDate) {
          const payload = {
            generatedAt: new Date().toISOString(),
            kpis,
            examInfo,
            indicatorParams: context.indicatorParams,
            indicatorsSummary,
            llm: {
              usedLlm: Boolean(llm.usedLlm),
              usedOllama: Boolean(llm.usedOllama),
              provider: llm.llmProvider || null,
              model: llm.model || null,
            },
            studyPlan: {
              days: taskPlan.days,
              tasksPerDay: taskPlan.tasksPerDay,
              itemsCount: Array.isArray(taskPlan.items) ? taskPlan.items.length : 0,
            },
          };

          await db.sequelize.query(
            `
              INSERT INTO public.user_daily_snapshot (
                user_id,
                snapshot_date,
                period_days,
                exam_date_raw,
                days_to_exam,
                readiness_score,
                consistency_score,
                avg_score_percent,
                completion_rate,
                abandon_rate,
                trend_delta_score7d,
                pass_probability_percent,
                pass_probability_overall_percent,
                pass_probability_threshold_percent,
                ind13_dominio_id,
                ind13_min_total,
                payload,
                created_at,
                updated_at
              ) VALUES (
                :userId,
                :snapshotDate::date,
                :periodDays,
                :examDateRaw,
                :daysToExam,
                :readinessScore,
                :consistencyScore,
                :avgScorePercent,
                :completionRate,
                :abandonRate,
                :trendDeltaScore7d,
                :passProbabilityPercent,
                :passProbabilityOverallPercent,
                :passProbabilityThresholdPercent,
                :ind13DominioId,
                :ind13MinTotal,
                :payload::jsonb,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
              )
              ON CONFLICT (user_id, snapshot_date)
              DO UPDATE SET
                period_days = EXCLUDED.period_days,
                exam_date_raw = EXCLUDED.exam_date_raw,
                days_to_exam = EXCLUDED.days_to_exam,
                readiness_score = EXCLUDED.readiness_score,
                consistency_score = EXCLUDED.consistency_score,
                avg_score_percent = EXCLUDED.avg_score_percent,
                completion_rate = EXCLUDED.completion_rate,
                abandon_rate = EXCLUDED.abandon_rate,
                trend_delta_score7d = EXCLUDED.trend_delta_score7d,
                pass_probability_percent = EXCLUDED.pass_probability_percent,
                pass_probability_overall_percent = EXCLUDED.pass_probability_overall_percent,
                pass_probability_threshold_percent = EXCLUDED.pass_probability_threshold_percent,
                ind13_dominio_id = EXCLUDED.ind13_dominio_id,
                ind13_min_total = EXCLUDED.ind13_min_total,
                payload = EXCLUDED.payload,
                updated_at = CURRENT_TIMESTAMP
            `,
            {
              replacements: {
                userId,
                snapshotDate,
                periodDays: days,
                examDateRaw: examInfo.examDateRaw,
                daysToExam: examInfo.daysToExam,
                readinessScore: kpis.readinessScore,
                consistencyScore: kpis.consistencyScore,
                avgScorePercent: kpis.avgScorePercent,
                completionRate: kpis.completionRate,
                abandonRate: kpis.abandonRate,
                trendDeltaScore7d: kpis.trendDeltaScore7d,
                passProbabilityPercent: kpis.passProbabilityPercent,
                passProbabilityOverallPercent: kpis.passProbabilityOverallPercent,
                passProbabilityThresholdPercent: kpis.passProbabilityThresholdPercent,
                ind13DominioId: context.indicatorParams.ind13DominioId,
                ind13MinTotal: context.indicatorParams.ind13MinTotal,
                payload: JSON.stringify(payload),
              },
            }
          );
        }
      }
    } catch (snapshotErr) {
      // Never break insights due to snapshot recording.
      logger.warn('Falha ao gravar snapshot diário de Insights', {
        userId,
        err: snapshotErr && snapshotErr.message ? snapshotErr.message : String(snapshotErr),
      });
    }

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
      studyPlan: taskPlan,
    });
  } catch (err) {
    return next(internalError('Erro interno', 'AI_INSIGHTS_ERROR', err));
  }
}

module.exports = {
  getInsightsDashboard,
};
