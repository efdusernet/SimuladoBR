#!/usr/bin/env node
/**
 * Script de reconciliação/reconstrução de estatísticas diárias (exam_attempt_user_stats).
 *
 * Uso:
 *   node backend/scripts/reconcile_user_stats.js --from 2025-11-01 --to 2025-11-21 --mode rebuild --dry-run
 *
 * Parâmetros:
 *   --from YYYY-MM-DD        Data inicial inclusiva (obrigatória)
 *   --to YYYY-MM-DD          Data final inclusiva (obrigatória)
 *   --user <id>              Opcional: limitar a um usuário específico
 *   --mode rebuild|merge     rebuild: apaga linhas no range e recria; merge: apenas atualiza/insere onde não existe
 *   --dry-run                Não persiste alterações; apenas mostra preview
 *
 * Estratégia:
 *   1. Carrega tentativas (exam_attempt) cujo StartedAt esteja dentro do range.
 *   2. Carrega logs de purga (exam_attempt_purge_log) cujo PurgedAt esteja dentro do range.
 *   3. Agrupa por (userId, date) gerando contagens e média ponderada de score.
 *   4. Aplica (rebuild ou merge) na tabela exam_attempt_user_stats.
 *
 * Limitações:
 *   - PurgedCount reconstruído apenas via log exam_attempt_purge_log.
 *   - Score médio considera somente tentativas finalizadas (Status='finished').
 *   - Dias sem StartedCount não são salvos (podemos inserir zero se desejado; aqui omitimos).
 */

require('dotenv').config();
const db = require('../models');
const { Op } = db.Sequelize;

function parseArgs(){
  const args = process.argv.slice(2);
  const out = { mode: 'rebuild', dryRun: false };
  for (let i=0;i<args.length;i++){
    const a = args[i];
    if (a === '--from') out.from = args[++i];
    else if (a === '--to') out.to = args[++i];
    else if (a === '--user') out.user = Number(args[++i]);
    else if (a === '--mode') out.mode = args[++i];
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

function toDate(d){
  if (!d) return null; return new Date(d + 'T00:00:00Z');
}

function ymd(d){ return d.toISOString().slice(0,10); }

async function main(){
  const cfg = parseArgs();
  if (!cfg.from || !cfg.to){
    console.error('Parâmetros obrigatórios: --from e --to');
    process.exit(1);
  }
  const fromDate = toDate(cfg.from);
  const toDate = toDate(cfg.to);
  if (!(fromDate && toDate) || fromDate > toDate){
    console.error('Intervalo inválido');
    process.exit(1);
  }
  await db.sequelize.authenticate();
  console.log('[reconcile] Intervalo', cfg.from, '→', cfg.to, 'mode=', cfg.mode, 'dryRun=', cfg.dryRun);

  // Ajuste de limite superior (+1 dia exclusivo para filtros <)
  const toDatePlus = new Date(toDate.getTime() + 86400000);

  const attemptWhere = {
    StartedAt: { [Op.gte]: fromDate, [Op.lt]: toDatePlus }
  };
  if (cfg.user && Number.isFinite(cfg.user) && cfg.user > 0){
    attemptWhere.UserId = cfg.user;
  }
  const attempts = await db.ExamAttempt.findAll({
    where: attemptWhere,
    attributes: ['Id','UserId','StartedAt','FinishedAt','Status','StatusReason','ScorePercent'],
    order: [['UserId','ASC'], ['StartedAt','ASC']]
  });
  console.log('[reconcile] Tentativas carregadas:', attempts.length);

  const purgeWhere = {
    PurgedAt: { [Op.gte]: fromDate, [Op.lt]: toDatePlus }
  };
  if (cfg.user && Number.isFinite(cfg.user) && cfg.user > 0){
    purgeWhere.UserId = cfg.user;
  }
  const purges = await db.ExamAttemptPurgeLog.findAll({
    where: purgeWhere,
    attributes: ['Id','UserId','PurgedAt'],
    order: [['UserId','ASC'], ['PurgedAt','ASC']]
  });
  console.log('[reconcile] Logs de purga carregados:', purges.length);

  // Aggregation map: key = `${userId}|${date}`
  const agg = new Map();

  function ensure(userId, dateStr){
    const k = userId + '|' + dateStr;
    if (!agg.has(k)) agg.set(k, {
      userId,
      date: dateStr,
      started: 0,
      finished: 0,
      abandoned: 0,
      timeout: 0,
      lowProgress: 0,
      purged: 0,
      scoreSum: 0,
      scoreCount: 0
    });
    return agg.get(k);
  }

  for (const at of attempts){
    if (!at.StartedAt || !at.UserId) continue;
    const dateStr = ymd(new Date(at.StartedAt));
    const row = ensure(at.UserId, dateStr);
    row.started++;
    if (at.Status === 'finished' || at.FinishedAt){
      row.finished++;
      if (at.ScorePercent != null){
        const sc = Number(at.ScorePercent);
        if (Number.isFinite(sc)) { row.scoreSum += sc; row.scoreCount += 1; }
      }
    } else if (at.Status === 'abandoned') {
      row.abandoned++;
      if (at.StatusReason === 'timeout_inactivity') row.timeout++;
      else if (at.StatusReason === 'abandoned_low_progress') row.lowProgress++;
    }
  }

  for (const pg of purges){
    if (!pg.PurgedAt || !pg.UserId) continue;
    const dateStr = ymd(new Date(pg.PurgedAt));
    const row = ensure(pg.UserId, dateStr);
    row.purged++;
  }

  // Prepare rows for persistence
  const rows = Array.from(agg.values()).map(r => {
    const avgScore = r.scoreCount > 0 ? Number((r.scoreSum / r.scoreCount).toFixed(3)) : null;
    return {
      userId: r.userId,
      date: r.date,
      started_count: r.started,
      finished_count: r.finished,
      abandoned_count: r.abandoned,
      timeout_count: r.timeout,
      low_progress_count: r.lowProgress,
      purged_count: r.purged,
      avg_score_percent: avgScore
    };
  }).sort((a,b)=> a.userId - b.userId || (a.date.localeCompare(b.date)));

  console.log('[reconcile] Dias agregados:', rows.length);
  if (!rows.length){ console.log('Nada para reconciliar.'); process.exit(0); }

  if (cfg.dryRun){
    console.log('--- PREVIEW (primeiros 10) ---');
    rows.slice(0,10).forEach(r => console.log(r));
    console.log('Dry-run: nenhuma alteração persistida.');
    process.exit(0);
  }

  const trx = await db.sequelize.transaction();
  try {
    if (cfg.mode === 'rebuild'){
      // Delete existing rows in range (optionally limited to user)
      const delWhere = {
        Date: { [Op.gte]: fromDate, [Op.lt]: toDatePlus }
      };
      if (cfg.user && Number.isFinite(cfg.user) && cfg.user > 0){
        delWhere.UserId = cfg.user;
      }
      const deleted = await db.ExamAttemptUserStats.destroy({ where: delWhere, transaction: trx });
      console.log('[reconcile] Linhas antigas removidas:', deleted);
    }

    // Bulk upsert via INSERT ... ON CONFLICT
    for (const chunk of chunkArray(rows, 500)){
      const valuesSql = chunk.map(r => `(${r.userId}, '${r.date}', ${r.started_count}, ${r.finished_count}, ${r.abandoned_count}, ${r.timeout_count}, ${r.low_progress_count}, ${r.purged_count}, ${r.avg_score_percent==null? 'NULL': r.avg_score_percent})`).join(',');
      const sql = `INSERT INTO exam_attempt_user_stats (user_id,date,started_count,finished_count,abandoned_count,timeout_count,low_progress_count,purged_count,avg_score_percent)
        VALUES ${valuesSql}
        ON CONFLICT (user_id,date) DO UPDATE SET
          started_count=EXCLUDED.started_count,
          finished_count=EXCLUDED.finished_count,
          abandoned_count=EXCLUDED.abandoned_count,
          timeout_count=EXCLUDED.timeout_count,
          low_progress_count=EXCLUDED.low_progress_count,
          purged_count=EXCLUDED.purged_count,
          avg_score_percent=EXCLUDED.avg_score_percent,
          updated_at=NOW();`;
      await db.sequelize.query(sql, { transaction: trx });
    }

    await trx.commit();
    console.log('[reconcile] Reconciliação concluída com sucesso.');
  } catch(err){
    await trx.rollback();
    console.error('Falha na reconciliação:', err);
    process.exit(1);
  }
  process.exit(0);
}

function chunkArray(arr, size){
  const out=[]; for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out;
}

main().catch(e => { console.error('Erro geral:', e); process.exit(1); });
