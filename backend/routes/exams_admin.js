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
            const date = att.StartedAt.toISOString().split('T')[0];
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
            const date = purge.PurgedAt.toISOString().split('T')[0];
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
                // Rebuild: INSERT ON CONFLICT DO UPDATE (sobrescreve)
                await db.sequelize.queryInterface.bulkInsert(
                    'exam_attempt_user_stats',
                    chunk.map(r => ({
                        user_id: r.UserId,
                        date: r.Date,
                        started_count: r.StartedCount,
                        finished_count: r.FinishedCount,
                        abandoned_count: r.AbandonedCount,
                        timeout_count: r.TimeoutCount,
                        low_progress_count: r.LowProgressCount,
                        purged_count: r.PurgedCount,
                        avg_score_percent: r.AvgScorePercent,
                        created_at: new Date(),
                        updated_at: new Date()
                    })),
                    {
                        updateOnDuplicate: [
                            'started_count',
                            'finished_count',
                            'abandoned_count',
                            'timeout_count',
                            'low_progress_count',
                            'purged_count',
                            'avg_score_percent',
                            'updated_at'
                        ]
                    }
                );
            } else {
                // Merge: incrementar valores existentes usando SQL bruto
                for (const record of chunk) {
                    const avgScoreValue = record.AvgScorePercent !== null ? record.AvgScorePercent : 'NULL';
                    await db.sequelize.query(`
                        INSERT INTO exam_attempt_user_stats (
                            user_id, date, started_count, finished_count, abandoned_count,
                            timeout_count, low_progress_count, purged_count, avg_score_percent,
                            created_at, updated_at
                        ) VALUES (
                            :userId, :date, :started, :finished, :abandoned,
                            :timeout, :lowProgress, :purged, :avgScore,
                            NOW(), NOW()
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
