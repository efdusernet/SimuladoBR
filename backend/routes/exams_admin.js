const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/requireAdmin');
const examController = require('../controllers/examController');
const db = require('../models');
const { ExamAttempt, ExamAttemptPurgeLog, ExamAttemptUserStats } = db;
const { Op } = require('sequelize');

// Admin-only endpoints for lifecycle management
router.post('/mark-abandoned', requireAdmin, examController.markAbandonedAttempts);
router.post('/purge-abandoned', requireAdmin, examController.purgeAbandonedAttempts);

// POST /api/admin/exams/fixture-attempt
// Body: { userId, overallPct, totalQuestions, examTypeSlug }
// Cria tentativa finalizada diretamente (fixture) para testes sem percorrer questões.
router.post('/exams/fixture-attempt', requireAdmin, async (req, res) => {
    try {
        const { userId, overallPct = 65, totalQuestions = 180, examTypeSlug = 'pmp' } = req.body || {};
        if(!userId) return res.status(400).json({ error: 'userId obrigatório' });
        const uid = Number(userId);
        if(!Number.isFinite(uid) || uid <= 0) return res.status(400).json({ error: 'userId inválido' });
        const user = await db.User.findByPk(uid);
        if(!user) return res.status(404).json({ error: 'Usuário não encontrado' });
        const examType = await db.ExamType.findOne({ where: { Slug: examTypeSlug } });
        if(!examType) return res.status(404).json({ error: 'ExamType não encontrado' });
        const qt = Math.max(1, Math.min(500, Number(totalQuestions)));
        const pct = Math.max(0, Math.min(100, Number(overallPct)));
        const corretas = Math.round(qt * (pct/100));
        // Selecionar questões
        const whereClauses = ["excluido = false","idstatus = 1",`exam_type_id = ${Number(examType.Id)}`];
        const whereSql = whereClauses.join(' AND ');
        const selectIdsQ = `SELECT id FROM questao WHERE ${whereSql} ORDER BY random() LIMIT :limit`;
        const questRows = await db.sequelize.query(selectIdsQ, { replacements: { limit: qt }, type: db.Sequelize.QueryTypes.SELECT });
        const questionIds = questRows.map(r => Number(r.id)).filter(n => Number.isFinite(n));
        if(questionIds.length < qt) return res.status(400).json({ error: 'Quantidade de questões insuficiente', available: questionIds.length });

        const startedAt = new Date(Date.now() - questionIds.length * 40000); // 40s médio
        let cumulativeSec = 0;
        const aprovMin = examType.PontuacaoMinimaPercent != null ? Number(examType.PontuacaoMinimaPercent) : null;
        const scorePercent = (corretas / questionIds.length * 100);
        const aprovado = aprovMin != null ? scorePercent >= aprovMin : null;
        let attemptId = null;

        await db.sequelize.transaction(async (t) => {
            const attempt = await db.ExamAttempt.create({
                UserId: uid,
                ExamTypeId: examType.Id,
                Modo: 'fixture',
                QuantidadeQuestoes: questionIds.length,
                ExamMode: 'full',
                StartedAt: startedAt,
                LastActivityAt: startedAt,
                Status: 'finished',
                Corretas: corretas,
                Total: questionIds.length,
                ScorePercent: scorePercent.toFixed(2),
                Aprovado: aprovado,
                PauseState: null,
                BlueprintSnapshot: {
                    id: examType.Slug,
                    nome: examType.Nome,
                    numeroQuestoes: examType.NumeroQuestoes,
                    duracaoMinutos: examType.DuracaoMinutos,
                    opcoesPorQuestao: examType.OpcoesPorQuestao,
                    multiplaSelecao: examType.MultiplaSelecao,
                    pontuacaoMinima: aprovMin
                },
                FiltrosUsados: { fixture: true },
                Meta: { origin: 'fixture-endpoint' },
                StatusReason: 'fixture-generated'
            }, { transaction: t });
            attemptId = attempt.Id;
            const aqRows = [];
            const ansRows = [];
            questionIds.forEach((qid, idx) => {
                const isCorrect = idx < corretas;
                const tempo = 25 + Math.floor(Math.random()*55); // 25-80s
                cumulativeSec += tempo;
                const qUpdated = new Date(startedAt.getTime() + cumulativeSec*1000);
                aqRows.push({ AttemptId: attemptId, QuestionId: qid, Ordem: idx+1, TempoGastoSegundos: tempo, Correta: isCorrect, Meta: null, CreatedAt: startedAt, UpdatedAt: qUpdated });
            });
            const insertedQuestions = await db.ExamAttemptQuestion.bulkCreate(aqRows, { transaction: t, returning: true });
            insertedQuestions.forEach(q => {
                ansRows.push({ AttemptQuestionId: q.Id, OptionId: null, Resposta: { auto: true }, Selecionada: true, CreatedAt: startedAt, UpdatedAt: q.UpdatedAt });
            });
            await db.ExamAttemptAnswer.bulkCreate(ansRows, { transaction: t });
            const finishedAt = new Date(startedAt.getTime() + cumulativeSec*1000 + 3000);
            await db.ExamAttempt.update({ FinishedAt: finishedAt, LastActivityAt: finishedAt }, { where: { Id: attemptId }, transaction: t });
        });

        return res.json({ attemptId, userId: uid, totalQuestions: questionIds.length, corretas, scorePercent: scorePercent.toFixed(2) });
    } catch (err) {
        console.error('Erro fixture-attempt:', err);
        return res.status(500).json({ error: 'Internal error' });
    }
});

/**
 * POST /api/admin/reconcile-stats
 * Reconciliação de estatísticas de usuários
 * Query params: from, to, mode (rebuild|merge), dryRun (true|false)
 */
router.post('/reconcile-stats', requireAdmin, async (req, res) => {
    try {
        const { from, to, mode = 'rebuild', dryRun = 'false' } = req.query;
        
        if (!from || !to) {
            return res.status(400).json({ error: 'Parâmetros from e to são obrigatórios (formato YYYY-MM-DD)' });
        }
        
        const fromDate = new Date(from);
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            return res.status(400).json({ error: 'Datas inválidas' });
        }
        
        if (fromDate > toDate) {
            return res.status(400).json({ error: 'Data inicial deve ser anterior à data final' });
        }
        
        const isDryRun = dryRun === 'true';
        const isRebuild = mode === 'rebuild';
        
        // Carregar tentativas do período
        const attempts = await ExamAttempt.findAll({
            where: {
                StartedAt: { [Op.between]: [fromDate, toDate] }
            },
            attributes: ['UserId', 'StartedAt', 'Status', 'ScorePercent', 'StatusReason'],
            raw: true
        });
        
        // Carregar logs de purga do período
        const purges = await ExamAttemptPurgeLog.findAll({
            where: {
                PurgedAt: { [Op.between]: [fromDate, toDate] }
            },
            attributes: ['UserId', 'PurgedAt'],
            raw: true
        });
        
        // Agrupar por (UserId, date)
        const aggregation = {};
        
        // Processar tentativas
        attempts.forEach(att => {
            const userId = att.UserId;
            const startedAt = att.StartedAt instanceof Date ? att.StartedAt : new Date(att.StartedAt);
            const date = startedAt.toISOString().split('T')[0];
            const key = `${userId}:${date}`;
            
            if (!aggregation[key]) {
                aggregation[key] = {
                    UserId: userId,
                    Date: date,
                    StartedCount: 0,
                    FinishedCount: 0,
                    AbandonedCount: 0,
                    TimeoutCount: 0,
                    LowProgressCount: 0,
                    PurgedCount: 0,
                    TotalScore: 0,
                    TotalFinished: 0
                };
            }
            
            const agg = aggregation[key];
            agg.StartedCount++;
            
            if (att.Status === 'finished') {
                agg.FinishedCount++;
                const score = parseFloat(att.ScorePercent) || 0;
                agg.TotalScore += score;
                agg.TotalFinished++;
            } else if (att.Status === 'abandoned') {
                agg.AbandonedCount++;
                const reason = att.StatusReason || '';
                if (reason.includes('timeout')) agg.TimeoutCount++;
                else if (reason.includes('low-progress')) agg.LowProgressCount++;
            }
        });
        
        // Processar purgas
        purges.forEach(purge => {
            const userId = purge.UserId;
            const purgedAt = purge.PurgedAt instanceof Date ? purge.PurgedAt : new Date(purge.PurgedAt);
            const date = purgedAt.toISOString().split('T')[0];
            const key = `${userId}:${date}`;
            
            if (!aggregation[key]) {
                aggregation[key] = {
                    UserId: userId,
                    Date: date,
                    StartedCount: 0,
                    FinishedCount: 0,
                    AbandonedCount: 0,
                    TimeoutCount: 0,
                    LowProgressCount: 0,
                    PurgedCount: 0,
                    TotalScore: 0,
                    TotalFinished: 0
                };
            }
            
            aggregation[key].PurgedCount++;
        });
        
        // Preparar registros para upsert
        const records = Object.values(aggregation).map(agg => ({
            UserId: agg.UserId,
            Date: agg.Date,
            StartedCount: agg.StartedCount,
            FinishedCount: agg.FinishedCount,
            AbandonedCount: agg.AbandonedCount,
            TimeoutCount: agg.TimeoutCount,
            LowProgressCount: agg.LowProgressCount,
            PurgedCount: agg.PurgedCount,
            AvgScorePercent: agg.TotalFinished > 0 ? agg.TotalScore / agg.TotalFinished : null
        }));
        
        if (isDryRun) {
            return res.json({
                message: 'Dry-run: nenhuma alteração foi feita',
                mode,
                period: { from, to },
                recordsToProcess: records.length,
                sample: records.slice(0, 5)
            });
        }
        
        // Executar upsert em lotes
        const CHUNK_SIZE = 100;
        let processed = 0;
        
        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
            const chunk = records.slice(i, i + CHUNK_SIZE);
            
            if (isRebuild) {
                // Rebuild: sobrescrever completamente via SQL bruto com chave (user_id, date)
                for (const r of chunk) {
                    await db.sequelize.query(`
                        INSERT INTO exam_attempt_user_stats (
                            user_id, date, started_count, finished_count, abandoned_count,
                            timeout_count, low_progress_count, purged_count, avg_score_percent, updated_at
                        ) VALUES (
                            :userId, :date, :started, :finished, :abandoned,
                            :timeout, :lowProgress, :purged, :avgScore, NOW()
                        )
                        ON CONFLICT (user_id, date) DO UPDATE SET
                            started_count = EXCLUDED.started_count,
                            finished_count = EXCLUDED.finished_count,
                            abandoned_count = EXCLUDED.abandoned_count,
                            timeout_count = EXCLUDED.timeout_count,
                            low_progress_count = EXCLUDED.low_progress_count,
                            purged_count = EXCLUDED.purged_count,
                            avg_score_percent = EXCLUDED.avg_score_percent,
                            updated_at = NOW()
                    `, {
                        replacements: {
                            userId: r.UserId,
                            date: r.Date,
                            started: r.StartedCount,
                            finished: r.FinishedCount,
                            abandoned: r.AbandonedCount,
                            timeout: r.TimeoutCount,
                            lowProgress: r.LowProgressCount,
                            purged: r.PurgedCount,
                            avgScore: r.AvgScorePercent
                        }
                    });
                }
            } else {
                // Merge: incrementar valores existentes usando SQL bruto
                for (const record of chunk) {
                    const avgScoreValue = record.AvgScorePercent !== null ? record.AvgScorePercent : 'NULL';
                    await db.sequelize.query(`
                        INSERT INTO exam_attempt_user_stats (
                            user_id, date, started_count, finished_count, abandoned_count,
                            timeout_count, low_progress_count, purged_count, avg_score_percent,
                            updated_at
                        ) VALUES (
                            :userId, :date, :started, :finished, :abandoned,
                            :timeout, :lowProgress, :purged, :avgScore,
                            NOW()
                        )
                        ON CONFLICT (user_id, date) DO UPDATE SET
                            started_count = exam_attempt_user_stats.started_count + :started,
                            finished_count = exam_attempt_user_stats.finished_count + :finished,
                            abandoned_count = exam_attempt_user_stats.abandoned_count + :abandoned,
                            timeout_count = exam_attempt_user_stats.timeout_count + :timeout,
                            low_progress_count = exam_attempt_user_stats.low_progress_count + :lowProgress,
                            purged_count = exam_attempt_user_stats.purged_count + :purged,
                            avg_score_percent = CASE 
                                WHEN :avgScore IS NOT NULL AND exam_attempt_user_stats.avg_score_percent IS NOT NULL
                                THEN (exam_attempt_user_stats.avg_score_percent + :avgScore) / 2
                                WHEN :avgScore IS NOT NULL
                                THEN :avgScore
                                ELSE exam_attempt_user_stats.avg_score_percent
                            END,
                            updated_at = NOW()
                    `, {
                        replacements: {
                            userId: record.UserId,
                            date: record.Date,
                            started: record.StartedCount,
                            finished: record.FinishedCount,
                            abandoned: record.AbandonedCount,
                            timeout: record.TimeoutCount,
                            lowProgress: record.LowProgressCount,
                            purged: record.PurgedCount,
                            avgScore: record.AvgScorePercent
                        },
                        type: db.sequelize.QueryTypes.INSERT
                    });
                }
            }
            
            processed += chunk.length;
        }
        
        res.json({
            message: 'Reconciliação concluída',
            mode,
            period: { from, to },
            attemptsProcessed: attempts.length,
            purgesProcessed: purges.length,
            recordsUpserted: processed
        });
        
    } catch (err) {
        console.error('Erro na reconciliação:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
