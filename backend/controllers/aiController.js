const db = require('../models');
const { badRequest, internalError } = require('../middleware/errors');
const buildUserStatsService = require('../services/UserStatsService');
const { generateJsonInsights } = require('../services/llmClient');
const indicatorController = require('./indicatorController');
const { logger } = require('../utils/logger');
const userParamsStore = require('../services/userParamsStore');

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

function summarizeInd14(ind14) {
  if (!ind14 || typeof ind14 !== 'object') return null;

  const lastItems = ind14.last && Array.isArray(ind14.last.itens) ? ind14.last.itens : [];
  const prevItems = ind14.previous && Array.isArray(ind14.previous.itens) ? ind14.previous.itens : [];

  const lastMap = new Map(lastItems.map((it) => [String(it && it.id != null ? it.id : ''), it]));
  const prevMap = new Map(prevItems.map((it) => [String(it && it.id != null ? it.id : ''), it]));
  const keys = new Set([...lastMap.keys(), ...prevMap.keys()].filter((k) => k));

  const compare = [];
  for (const key of keys) {
    const l = lastMap.get(key);
    const p = prevMap.get(key);

    const label = (l && l.descricao != null) ? String(l.descricao)
      : ((p && p.descricao != null) ? String(p.descricao) : String(key));

    const last = (l && l.percentCorretas != null && Number.isFinite(Number(l.percentCorretas))) ? Number(l.percentCorretas) : null;
    const previous = (p && p.percentCorretas != null && Number.isFinite(Number(p.percentCorretas))) ? Number(p.percentCorretas) : null;

    // Keep compare compact: only rows that have at least one valid percentage.
    if (last == null && previous == null) continue;

    const delta = (last != null && previous != null) ? Number((last - previous).toFixed(2)) : null;
    compare.push({ label, last, previous, delta });
  }

  const deltas = compare.filter((r) => r.delta != null && Number.isFinite(Number(r.delta)));
  const biggestDrops = deltas.slice().sort((a, b) => a.delta - b.delta).slice(0, 5);
  const biggestImprovements = deltas.slice().sort((a, b) => b.delta - a.delta).slice(0, 5);

  const persistentWeak = compare
    .filter((r) => r.last != null && r.previous != null && r.last < 70 && r.previous < 70)
    .sort((a, b) => (a.last - b.last) || (a.previous - b.previous) || a.label.localeCompare(b.label, 'pt-BR'))
    .slice(0, 8);

  return {
    examMode: ind14.examMode != null ? String(ind14.examMode) : null,
    lastFinishedAt: ind14.last && ind14.last.finished_at ? ind14.last.finished_at : null,
    previousFinishedAt: ind14.previous && ind14.previous.finished_at ? ind14.previous.finished_at : null,
    last: pickTopBottom(lastItems, { valueKey: 'percentCorretas', labelKey: 'descricao', topN: 5, bottomN: 5 }),
    previous: pickTopBottom(prevItems, { valueKey: 'percentCorretas', labelKey: 'descricao', topN: 5, bottomN: 5 }),
    biggestDrops,
    biggestImprovements,
    persistentWeak,
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

function parseOptionalInt(value) {
  if (value == null) return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function pctFromCounts(numerator, denominator) {
  const den = Number(denominator) || 0;
  const num = Number(numerator) || 0;
  if (!den) return null;
  return Number(((num / den) * 100).toFixed(1));
}

async function getFlashcardsInsights(userId, { minTotal = 5, topN = 10 } = {}) {
  const minTotalClamped = clamp(minTotal, 1, 200);
  const topNClamped = clamp(topN, 1, 50);

  async function perfForDays(days) {
    const where = days == null
      ? 'WHERE aa.user_id = $user_id'
      : 'WHERE aa.user_id = $user_id AND aa.updated_at >= NOW() - ($days::text || \' days\')::interval';

    const rows = await db.sequelize.query(
      `SELECT
         COUNT(*)::int AS total_answers,
         COUNT(DISTINCT aa.flashcard_id)::int AS distinct_cards,
         SUM(CASE WHEN aa.correct THEN 1 ELSE 0 END)::int AS correct_answers,
         SUM(CASE WHEN aa.correct THEN 0 ELSE 1 END)::int AS incorrect_answers
       FROM public.flashcard_attempt_answer aa
       ${where};`,
      {
        type: db.sequelize.QueryTypes.SELECT,
        bind: {
          user_id: Number(userId),
          ...(days == null ? {} : { days: Number(days) }),
        },
      }
    );
    const r = Array.isArray(rows) && rows.length ? rows[0] : {};
    const total = Number(r.total_answers) || 0;
    const correct = Number(r.correct_answers) || 0;
    const incorrect = Number(r.incorrect_answers) || 0;

    return {
      days: days == null ? null : Number(days),
      totalAnswers: total,
      distinctCards: Number(r.distinct_cards) || 0,
      correctAnswers: correct,
      incorrectAnswers: incorrect,
      correctPct: pctFromCounts(correct, total),
      errorPct: pctFromCounts(incorrect, total),
    };
  }

  async function attemptsForDays(days) {
    const where = days == null
      ? 'WHERE a.user_id = $user_id'
      : 'WHERE a.user_id = $user_id AND a.started_at >= NOW() - ($days::text || \' days\')::interval';

    // Prefer status column. If it doesn't exist (older DB), fallback to finished_at heuristic.
    try {
      const rows = await db.sequelize.query(
        `SELECT a.status AS status, COUNT(*)::int AS total
           FROM public.flashcard_attempt a
           ${where}
          GROUP BY a.status;`,
        {
          type: db.sequelize.QueryTypes.SELECT,
          bind: {
            user_id: Number(userId),
            ...(days == null ? {} : { days: Number(days) }),
          },
        }
      );
      const counts = (rows || []).reduce((acc, r) => {
        const s = (r && r.status != null) ? String(r.status) : 'unknown';
        acc[s] = (acc[s] || 0) + (Number(r.total) || 0);
        return acc;
      }, {});
      const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
      const abandoned = Number(counts.abandoned) || 0;
      return {
        days: days == null ? null : Number(days),
        totalAttempts: total,
        byStatus: {
          active: Number(counts.active) || 0,
          finished: Number(counts.finished) || 0,
          abandoned,
        },
        abandonRate: total ? Number((abandoned / total).toFixed(3)) : null,
      };
    } catch (e) {
      const rows = await db.sequelize.query(
        `SELECT
           CASE WHEN a.finished_at IS NOT NULL THEN 'finished' ELSE 'active' END AS status,
           COUNT(*)::int AS total
         FROM public.flashcard_attempt a
         ${where}
         GROUP BY 1;`,
        {
          type: db.sequelize.QueryTypes.SELECT,
          bind: {
            user_id: Number(userId),
            ...(days == null ? {} : { days: Number(days) }),
          },
        }
      );
      const counts = (rows || []).reduce((acc, r) => {
        const s = (r && r.status != null) ? String(r.status) : 'unknown';
        acc[s] = (acc[s] || 0) + (Number(r.total) || 0);
        return acc;
      }, {});
      const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
      return {
        days: days == null ? null : Number(days),
        totalAttempts: total,
        byStatus: {
          active: Number(counts.active) || 0,
          finished: Number(counts.finished) || 0,
          abandoned: null,
        },
        abandonRate: null,
        note: 'Banco sem coluna status; abandono indisponível.'
      };
    }
  }

  async function breakdownForDays(days, { dim, labelTable, labelCol = 'descricao', labelIdCol = 'id' }) {
    const where = `WHERE aa.user_id = $user_id
      AND aa.${dim} IS NOT NULL
      AND aa.updated_at >= NOW() - ($days::text || ' days')::interval`;

    let rows = [];
    try {
      rows = await db.sequelize.query(
        `SELECT
           aa.${dim}::int AS id,
           COALESCE(t.${labelCol}::text, ('#' || aa.${dim}::text)) AS descricao,
           COUNT(*)::int AS total,
           SUM(CASE WHEN aa.correct THEN 0 ELSE 1 END)::int AS erros,
           ROUND(100.0 * (SUM(CASE WHEN aa.correct THEN 0 ELSE 1 END)::numeric / NULLIF(COUNT(*)::numeric, 0)), 1) AS taxa_erro_pct,
           ROUND(100.0 * AVG(CASE WHEN aa.correct THEN 1 ELSE 0 END), 1) AS acerto_pct
         FROM public.flashcard_attempt_answer aa
         LEFT JOIN public.${labelTable} t ON t.${labelIdCol} = aa.${dim}
         ${where}
         GROUP BY aa.${dim}, t.${labelCol}
         HAVING COUNT(*) >= $min_total
         ORDER BY taxa_erro_pct DESC, erros DESC
         LIMIT $top_n;`,
        {
          type: db.sequelize.QueryTypes.SELECT,
          bind: {
            user_id: Number(userId),
            days: Number(days),
            min_total: Number(minTotalClamped),
            top_n: Number(topNClamped),
          },
        }
      );
    } catch (e) {
      // Fallback: no join (keeps the endpoint working even if meta table columns differ).
      logger.warn('[ai/insights] flashcards breakdown join failed; using fallback without join', { dim, labelTable, error: e && e.message ? e.message : String(e) });
      rows = await db.sequelize.query(
        `SELECT
           aa.${dim}::int AS id,
           ('#' || aa.${dim}::text) AS descricao,
           COUNT(*)::int AS total,
           SUM(CASE WHEN aa.correct THEN 0 ELSE 1 END)::int AS erros,
           ROUND(100.0 * (SUM(CASE WHEN aa.correct THEN 0 ELSE 1 END)::numeric / NULLIF(COUNT(*)::numeric, 0)), 1) AS taxa_erro_pct,
           ROUND(100.0 * AVG(CASE WHEN aa.correct THEN 1 ELSE 0 END), 1) AS acerto_pct
         FROM public.flashcard_attempt_answer aa
         ${where}
         GROUP BY aa.${dim}
         HAVING COUNT(*) >= $min_total
         ORDER BY taxa_erro_pct DESC, erros DESC
         LIMIT $top_n;`,
        {
          type: db.sequelize.QueryTypes.SELECT,
          bind: {
            user_id: Number(userId),
            days: Number(days),
            min_total: Number(minTotalClamped),
            top_n: Number(topNClamped),
          },
        }
      );
    }

    return (rows || []).map(r => ({
      id: r.id != null ? Number(r.id) : null,
      descricao: r.descricao != null ? String(r.descricao) : '—',
      total: Number(r.total) || 0,
      erros: Number(r.erros) || 0,
      taxaErroPct: r.taxa_erro_pct != null ? Number(r.taxa_erro_pct) : null,
      acertoPct: r.acerto_pct != null ? Number(r.acerto_pct) : null,
    }));
  }

  async function basicsForDays(days) {
    const rows = await db.sequelize.query(
      `SELECT
         aa.basics AS basics,
         COUNT(*)::int AS total,
         SUM(CASE WHEN aa.correct THEN 0 ELSE 1 END)::int AS erros,
         ROUND(100.0 * AVG(CASE WHEN aa.correct THEN 1 ELSE 0 END), 1) AS acerto_pct
       FROM public.flashcard_attempt_answer aa
       WHERE aa.user_id = $user_id
         AND aa.updated_at >= NOW() - ($days::text || ' days')::interval
       GROUP BY aa.basics
       ORDER BY aa.basics DESC;`,
      { type: db.sequelize.QueryTypes.SELECT, bind: { user_id: Number(userId), days: Number(days) } }
    );
    return (rows || []).map(r => ({
      basics: Boolean(r.basics),
      total: Number(r.total) || 0,
      erros: Number(r.erros) || 0,
      acertoPct: r.acerto_pct != null ? Number(r.acerto_pct) : null,
      taxaErroPct: pctFromCounts(Number(r.erros) || 0, Number(r.total) || 0),
    }));
  }

  async function topCardsForDays(days) {
    let rows = [];
    try {
      rows = await db.sequelize.query(
        `SELECT
           aa.flashcard_id::bigint AS id,
           LEFT(COALESCE(f.pergunta::text, ''), 140) AS pergunta,
           COUNT(*)::int AS total,
           SUM(CASE WHEN aa.correct THEN 0 ELSE 1 END)::int AS erros,
           ROUND(100.0 * (SUM(CASE WHEN aa.correct THEN 0 ELSE 1 END)::numeric / NULLIF(COUNT(*)::numeric, 0)), 1) AS taxa_erro_pct,
           MAX(aa.idprincipio)::int AS idprincipio,
           MAX(aa.iddominio_desempenho)::int AS iddominio_desempenho,
           MAX(aa.idabordagem)::int AS idabordagem,
           MAX(aa.basics)::boolean AS basics
         FROM public.flashcard_attempt_answer aa
         LEFT JOIN public.flashcard f ON f.id = aa.flashcard_id
         WHERE aa.user_id = $user_id
           AND aa.updated_at >= NOW() - ($days::text || ' days')::interval
         GROUP BY aa.flashcard_id, f.pergunta
         HAVING COUNT(*) >= $min_total
         ORDER BY taxa_erro_pct DESC, erros DESC
         LIMIT $top_n;`,
        {
          type: db.sequelize.QueryTypes.SELECT,
          bind: {
            user_id: Number(userId),
            days: Number(days),
            min_total: Number(minTotalClamped),
            top_n: Number(topNClamped),
          },
        }
      );
    } catch (e) {
      logger.warn('[ai/insights] flashcards topCards join failed; using fallback without question text', { error: e && e.message ? e.message : String(e) });
      rows = await db.sequelize.query(
        `SELECT
           aa.flashcard_id::bigint AS id,
           ''::text AS pergunta,
           COUNT(*)::int AS total,
           SUM(CASE WHEN aa.correct THEN 0 ELSE 1 END)::int AS erros,
           ROUND(100.0 * (SUM(CASE WHEN aa.correct THEN 0 ELSE 1 END)::numeric / NULLIF(COUNT(*)::numeric, 0)), 1) AS taxa_erro_pct,
           MAX(aa.idprincipio)::int AS idprincipio,
           MAX(aa.iddominio_desempenho)::int AS iddominio_desempenho,
           MAX(aa.idabordagem)::int AS idabordagem,
           MAX(aa.basics)::boolean AS basics
         FROM public.flashcard_attempt_answer aa
         WHERE aa.user_id = $user_id
           AND aa.updated_at >= NOW() - ($days::text || ' days')::interval
         GROUP BY aa.flashcard_id
         HAVING COUNT(*) >= $min_total
         ORDER BY taxa_erro_pct DESC, erros DESC
         LIMIT $top_n;`,
        {
          type: db.sequelize.QueryTypes.SELECT,
          bind: {
            user_id: Number(userId),
            days: Number(days),
            min_total: Number(minTotalClamped),
            top_n: Number(topNClamped),
          },
        }
      );
    }
    return (rows || []).map(r => ({
      id: r.id != null ? Number(r.id) : null,
      pergunta: r.pergunta != null ? String(r.pergunta) : '',
      total: Number(r.total) || 0,
      erros: Number(r.erros) || 0,
      taxaErroPct: r.taxa_erro_pct != null ? Number(r.taxa_erro_pct) : null,
      idprincipio: r.idprincipio != null ? Number(r.idprincipio) : null,
      iddominio_desempenho: r.iddominio_desempenho != null ? Number(r.iddominio_desempenho) : null,
      idabordagem: r.idabordagem != null ? Number(r.idabordagem) : null,
      basics: r.basics != null ? Boolean(r.basics) : false,
    }));
  }

  const [perf7, perf30, perfAll, attempts7, attempts30, attemptsAll, byPrincipio30, byDominio30, byAbordagem30, basics30, topCards30] = await Promise.all([
    perfForDays(7),
    perfForDays(30),
    perfForDays(null),
    attemptsForDays(7),
    attemptsForDays(30),
    attemptsForDays(null),
    breakdownForDays(30, { dim: 'idprincipio', labelTable: 'principios' }),
    breakdownForDays(30, { dim: 'iddominio_desempenho', labelTable: 'dominio_desempenho' }),
    breakdownForDays(30, { dim: 'idabordagem', labelTable: 'abordagem' }),
    basicsForDays(30),
    topCardsForDays(30),
  ]);

  return {
    meta: {
      minTotal: minTotalClamped,
      topN: topNClamped,
      note: 'Dados de flashcards usam o estado final do card por attempt (UPSERT por attempt_id + flashcard_id).',
    },
    performance: { last7: perf7, last30: perf30, allTime: perfAll },
    attempts: { last7: attempts7, last30: attempts30, allTime: attemptsAll },
    byPrincipio: { last30: byPrincipio30 },
    byDominioDesempenho: { last30: byDominio30 },
    byAbordagem: { last30: byAbordagem30 },
    byBasics: { last30: basics30 },
    topCards: { last30: topCards30 },
  };
}

async function safeGetFlashcardsInsights(userId, opts) {
  const t0 = Date.now();
  try {
    const data = await getFlashcardsInsights(userId, opts);
    return { ok: true, data, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Erro desconhecido';
    return { ok: false, data: null, error: msg, ms: Date.now() - t0 };
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

function buildExplainabilityForRiskMessage(message, { kpis, examInfo, indicatorsSummary } = {}) {
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
  const ind14 = indicatorsSummary && indicatorsSummary.IND14 ? indicatorsSummary.IND14 : null;

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
      source: 'usuario.data_exame',
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

  if (/Dom[ií]nios/i.test(msg) && (/pen[úu]ltim/i.test(msg) || /[úu]ltima vs\. pen[úu]ltima/i.test(msg) || /comparad[oa] \`?a pen[úu]ltim/i.test(msg) || /queda relevante/i.test(msg) || /consistentemente fracos/i.test(msg))) {
    const worst = ind14 && Array.isArray(ind14.biggestDrops) && ind14.biggestDrops.length ? ind14.biggestDrops[0] : null;
    const label = worst && worst.label ? String(worst.label) : null;
    const last = worst && worst.last != null ? Number(worst.last) : null;
    const previous = worst && worst.previous != null ? Number(worst.previous) : null;
    const delta = worst && worst.delta != null ? Number(worst.delta) : null;

    add({
      source: 'IND14',
      metric: 'domainsLastVsPrevious',
      label: 'Domínios — última vs penúltima (DG-DET-LAST2)',
      value: (delta != null && Number.isFinite(delta)) ? pct1(delta) : null,
      unit: 'pp',
      details: (label && last != null && previous != null)
        ? `Maior queda recente: ${label} (${pct1(previous)}% → ${pct1(last)}%).`
        : 'Comparação do % de corretas por domínio geral entre as 2 últimas tentativas concluídas.',
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

function attachExplainability(ai, { kpis, examInfo, indicatorsSummary } = {}) {
  const out = ai && typeof ai === 'object' ? { ...ai } : {};
  const risks = Array.isArray(out.risks) ? out.risks : [];
  const alerts = [];
  let mergedRules = null;

  for (const r of risks) {
    const a = buildExplainabilityForRiskMessage(r, { kpis, examInfo, indicatorsSummary });
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

function enrichAiWithRules(ai, { kpis, examInfo, indicatorsSummary } = {}) {
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

  const ind14 = indicatorsSummary && indicatorsSummary.IND14 ? indicatorsSummary.IND14 : null;

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

  // IND14 (Domínios — última vs penúltima): recomendações de estabilidade por domínio.
  if (ind14 && typeof ind14 === 'object') {
    const drops = Array.isArray(ind14.biggestDrops) ? ind14.biggestDrops : [];
    const imps = Array.isArray(ind14.biggestImprovements) ? ind14.biggestImprovements : [];
    const weak = Array.isArray(ind14.persistentWeak) ? ind14.persistentWeak : [];

    const worstDrop = drops.length ? drops[0] : null;
    const worstDelta = worstDrop && worstDrop.delta != null ? Number(worstDrop.delta) : null;
    if (worstDrop && Number.isFinite(worstDelta) && worstDelta <= -10) {
      const top = drops.slice(0, 3).map(d => `${d.label} (Δ ${d.delta}pp)`).join(', ');
      out.risks = addUnique(out.risks, `Queda relevante vs. penúltima tentativa em Domínios: ${top}. Priorize revisão dirigida nesses tópicos antes do próximo simulado.`);
      out.actions7d = addUnique(out.actions7d, `Revisar 2 domínios com maior queda (última vs penúltima): ${drops.slice(0, 2).map(d => d.label).join(' e ')}.`);
    } else if (worstDrop && Number.isFinite(worstDelta) && worstDelta <= -6) {
      out.insights = addUnique(out.insights, `Oscilação recente por domínio (última vs penúltima): a maior queda foi em ${worstDrop.label} (Δ ${worstDrop.delta}pp).`);
    }

    if (weak.length) {
      const list = weak.slice(0, 4).map(d => d.label).join(', ');
      out.risks = addUnique(out.risks, `Domínios consistentemente fracos (<70% nas 2 últimas tentativas): ${list}.`);
      out.actions7d = addUnique(out.actions7d, `Fazer revisão dirigida de 1–2 domínios consistentemente fracos: ${weak.slice(0, 2).map(d => d.label).join(' e ')}.`);
    }

    const bestImp = imps.length ? imps[0] : null;
    const bestDelta = bestImp && bestImp.delta != null ? Number(bestImp.delta) : null;
    if (bestImp && Number.isFinite(bestDelta) && bestDelta >= 10) {
      out.insights = addUnique(out.insights, `Melhora relevante vs. penúltima tentativa em Domínios: ${imps.slice(0, 3).map(d => `${d.label} (+${d.delta}pp)`).join(', ')}.`);
    }
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
      // IND14: compara domínios (dominio geral) entre última e penúltima tentativa concluída
      safeRunIndicator('IND14', indicatorController.getDominioGeralDetailsLastTwo, { query: { idUsuario: String(userId), exam_mode: 'full' }, user: indicatorUser }),
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
      note: 'Dados agregados por dia; inclui indicadores IND1..IND7, IND9..IND14 (valores resumidos); não inclui texto das questões.',
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
      IND14: summarizeInd14(indicators.IND14),
      PASS: {
        probabilityPercent: passProb.probabilityPercent,
        overallPercent: passProb.overallPercent,
        thresholdPercent: passProb.passThreshold,
      },
    };

    const fcMinTotal = (() => {
      const n = parseOptionalInt(req.query.fc_min_total);
      return Number.isFinite(n) ? n : 5;
    })();
    const fcTopN = (() => {
      const n = parseOptionalInt(req.query.fc_top_n);
      return Number.isFinite(n) ? n : 10;
    })();

    const flashcardsResult = await safeGetFlashcardsInsights(userId, { minTotal: fcMinTotal, topN: fcTopN });
    const flashcards = flashcardsResult.ok ? flashcardsResult.data : null;

    const flashcardsSummary = flashcards ? {
      last30: {
        performance: flashcards.performance.last30,
        attempts: flashcards.attempts.last30,
        byPrincipioTop: (flashcards.byPrincipio.last30 || []).slice(0, 5),
        byDominioTop: (flashcards.byDominioDesempenho.last30 || []).slice(0, 5),
        byAbordagemTop: (flashcards.byAbordagem.last30 || []).slice(0, 5),
        basics: flashcards.byBasics.last30,
        topCards: (flashcards.topCards.last30 || []).slice(0, 5).map(c => ({ id: c.id, erros: c.erros, total: c.total, taxaErroPct: c.taxaErroPct, basics: c.basics })),
      },
    } : null;

    // Add compact flashcards summary to the AI prompt.
    const contextForAi = {
      ...context,
      flashcards: flashcardsSummary,
    };

    const indicatorsForAi = {
      ...indicatorsSummary,
      ...(flashcardsSummary ? { FLASHCARDS: flashcardsSummary.last30 } : {}),
    };

    const llm = await generateJsonInsights({ context: contextForAi, kpis, timeseries: timeseriesForAi, indicators: indicatorsForAi });
    const baseAi = llm.insights || buildFallbackInsights({ kpis, trendDelta });
    const ai = attachExplainability(enrichAiWithRules(baseAi, { kpis, examInfo, indicatorsSummary }), { kpis, examInfo, indicatorsSummary });

    // If no LLM, still present the plan as a concrete next step
    if (!llm.usedLlm && taskPlan && Array.isArray(taskPlan.items) && taskPlan.items.length) {
      ai.actions7d = addUnique(ai.actions7d, 'Siga o “Plano de 7 dias (Tasks)” abaixo para atacar as prioridades por impacto.');
    }

    // Record a daily snapshot (default: paying users only). This is the groundwork for a real temporal risk model.
    try {
      const isPaying = Boolean(userRow) && userRow.BloqueioAtivado === false;
      const params = await userParamsStore.getCachedParams({ maxAgeMs: 10_000 });
      const premiumOnly = !(params && params.premiumOnly && params.premiumOnly.aiDailySnapshot === false);
      const shouldRecord = premiumOnly ? isPaying : true;
      if (shouldRecord && db && db.sequelize) {
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
          flashcardsTimings: flashcardsResult ? { ok: flashcardsResult.ok, ms: flashcardsResult.ms, error: flashcardsResult.ok ? null : flashcardsResult.error } : null,
        } : {}),
        ...(process.env.NODE_ENV === 'development' && indicatorErrors.length ? { indicatorErrors } : {}),
      },
      kpis,
      timeseries: series,
      indicators,
      indicatorsSummary,
      flashcards,
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
