const db = require('../models');

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
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
    } catch (_e) {
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
    } catch (_e) {
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
           BOOL_OR(aa.basics) AS basics
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
    } catch (_e) {
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
           BOOL_OR(aa.basics) AS basics
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

module.exports = {
  getFlashcardsInsights,
  safeGetFlashcardsInsights,
};
