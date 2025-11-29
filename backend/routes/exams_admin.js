const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/requireAdmin');
const examController = require('../controllers/examController');
const db = require('../models');
const { ExamAttempt, ExamAttemptPurgeLog, ExamAttemptUserStats } = db;
const { Op } = require('sequelize');

// Admin-only endpoints for lifecycle management
// Lightweight probe endpoint for front-end admin menu detection (returns 204 if admin)
router.get('/probe', requireAdmin, (req, res) => res.status(204).end());
router.post('/mark-abandoned', requireAdmin, examController.markAbandonedAttempts);
router.post('/purge-abandoned', requireAdmin, examController.purgeAbandonedAttempts);

// POST /api/admin/exams/fixture-attempt
// Body: { userId, overallPct, totalQuestions, examTypeSlug, peoplePct?, processPct?, businessPct? }
// Cria tentativa finalizada diretamente (fixture) para testes sem percorrer questões.
// NOTE: Mounted at /api/admin/exams, so path here must NOT repeat '/exams'
router.post('/fixture-attempt', requireAdmin, async (req, res) => {
    try {
        const { userId, overallPct = 65, totalQuestions = 180, examTypeSlug = 'pmp', peoplePct, processPct, businessPct } = req.body || {};
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
        function parseDom(v){ if(v==null || v==='') return null; const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null; }
        const peopleVal = parseDom(peoplePct);
        const processVal = parseDom(processPct);
        const businessVal = parseDom(businessPct);
        // Validação de coerência server-side: ou informa todos os domínios ou nenhum
        const domVals = [peopleVal, processVal, businessVal];
        const anyProvided = domVals.some(v => v != null);
        const allProvided = domVals.every(v => v != null);
        if(anyProvided && !allProvided){
            return res.status(400).json({ error: 'Forneça todos os percentuais de domínio (people, process, business) ou nenhum.' });
        }
        if(allProvided){
            const meanDom = (peopleVal + processVal + businessVal) / 3;
            const tolerance = Number(req.query.tolerance != null ? req.query.tolerance : 2);
            if(!Number.isFinite(tolerance) || tolerance < 0) return res.status(400).json({ error: 'Tolerance inválida' });
            const diff = Math.abs(meanDom - pct);
            if(diff > tolerance){
                return res.status(400).json({ error: `Incoerência: média domínios (${meanDom.toFixed(2)}%) difere de overallPct (${pct.toFixed(2)}%) além da tolerância (${tolerance}).`, details: { meanDom: meanDom.toFixed(2), overall: pct.toFixed(2), diff: diff.toFixed(2), tolerance } });
            }
        }
        function labelFromPct(p){ if(p==null) return '—'; if(p<=25) return 'Needs Improvement'; if(p<=50) return 'Below Target'; if(p<=75) return 'Target'; return 'Above Target'; }
        // Selecionar questões
        const whereClauses = ["excluido = false","idstatus = 1",`exam_type_id = ${Number(examType.Id)}`];
        const whereSql = whereClauses.join(' AND ');
        // Selecionar questões com iddominiogeral para permitir distribuição por domínio
        const selectRowsQ = `SELECT id, iddominiogeral FROM questao WHERE ${whereSql} ORDER BY random() LIMIT :limit`;
        const questRows = await db.sequelize.query(selectRowsQ, { replacements: { limit: qt }, type: db.Sequelize.QueryTypes.SELECT });
        const questionIds = questRows.map(r => Number(r.id)).filter(n => Number.isFinite(n));
        if(questionIds.length < qt) return res.status(400).json({ error: 'Quantidade de questões insuficiente', available: questionIds.length });
        // Mapear domínios brutos
        const domainMap = {};
        questRows.forEach((r, idx) => {
            const dId = (r.iddominiogeral != null ? Number(r.iddominiogeral) : null);
            const key = dId != null && Number.isFinite(dId) ? dId : 'null';
            if(!domainMap[key]) domainMap[key] = { questions: [], count: 0 };
            domainMap[key].questions.push(idx);
            domainMap[key].count++;
        });
        const validDomainIds = Object.keys(domainMap).filter(k => k !== 'null').map(k => Number(k));
        let domainDescMap = {};
        if(validDomainIds.length){
            try {
                const domRows = await db.sequelize.query(`SELECT id, descricao FROM dominiogeral WHERE id IN (${validDomainIds.join(',')})`, { type: db.Sequelize.QueryTypes.SELECT });
                domRows.forEach(dr => { domainDescMap[Number(dr.id)] = dr.descricao; });
            } catch(e){ console.warn('Falha carregar dominiogeral:', e.message); }
        }
        function keyFromDesc(desc){
            if(!desc || typeof desc !== 'string') return null;
            const d = desc.toLowerCase();
            if(/people|pessoa/.test(d)) return 'people';
            if(/process/.test(d)) return 'process';
            if(/business|negoci|ambiente/.test(d)) return 'business';
            return null;
        }
        const semanticDomains = { people: [], process: [], business: [] };
        const unmappedDomainIds = [];
        validDomainIds.forEach(did => {
            const semKey = keyFromDesc(domainDescMap[did]);
            if(semKey){ domainMap[did].questions.forEach(idx => semanticDomains[semKey].push(idx)); }
            else { unmappedDomainIds.push(did); }
        });
        const fallbackKeys = ['people','process','business'].filter(k => semanticDomains[k].length === 0);
        let fkPtr = 0;
        unmappedDomainIds.forEach(did => {
            const assignKey = fallbackKeys[fkPtr] || 'process';
            domainMap[did].questions.forEach(idx => semanticDomains[assignKey].push(idx));
            if(fkPtr < fallbackKeys.length - 1) fkPtr++;
        });
        const overallCorrectTarget = corretas;
        let perDomainTargets = { people: 0, process: 0, business: 0 };
        const requested = { people: peopleVal, process: processVal, business: businessVal };
        const domainCounts = { people: semanticDomains.people.length, process: semanticDomains.process.length, business: semanticDomains.business.length };
        const hasRequested = [peopleVal, processVal, businessVal].some(v => v != null);
        if(hasRequested){
            const fractional = [];
            Object.keys(perDomainTargets).forEach(k => {
                const cnt = domainCounts[k];
                const reqPct = requested[k];
                if(cnt === 0 || reqPct == null){ perDomainTargets[k] = 0; return; }
                const ideal = reqPct/100 * cnt;
                const base = Math.floor(ideal);
                perDomainTargets[k] = base;
                fractional.push({ k, frac: ideal - base, cap: cnt });
            });
            let currentSum = Object.values(perDomainTargets).reduce((a,b)=>a+b,0);
            let remaining = overallCorrectTarget - currentSum;
            if(remaining > 0){
                fractional.sort((a,b)=>b.frac - a.frac);
                for(const f of fractional){ if(remaining <= 0) break; if(perDomainTargets[f.k] < f.cap){ perDomainTargets[f.k]++; remaining--; } }
            } else if(remaining < 0){
                fractional.sort((a,b)=>a.frac - b.frac);
                for(const f of fractional){ if(remaining >= 0) break; if(perDomainTargets[f.k] > 0){ perDomainTargets[f.k]--; remaining++; } }
            }
            if(remaining !== 0){
                const order = ['people','process','business'];
                for(const k of order){
                    if(remaining === 0) break;
                    const cap = domainCounts[k];
                    if(remaining > 0 && perDomainTargets[k] < cap){ perDomainTargets[k]++; remaining--; }
                    else if(remaining < 0 && perDomainTargets[k] > 0){ perDomainTargets[k]--; remaining++; }
                }
            }
        } else {
            perDomainTargets.people = Math.round(domainCounts.people * (pct/100));
            perDomainTargets.process = Math.round(domainCounts.process * (pct/100));
            perDomainTargets.business = Math.round(domainCounts.business * (pct/100));
        }
        let sumDomainCorrects = Object.values(perDomainTargets).reduce((a,b)=>a+b,0);
        if(sumDomainCorrects > overallCorrectTarget){
            const ordered = Object.keys(perDomainTargets).sort((a,b)=>perDomainTargets[b]-perDomainTargets[a]);
            for(const k of ordered){ if(sumDomainCorrects <= overallCorrectTarget) break; if(perDomainTargets[k] > 0){ perDomainTargets[k]--; sumDomainCorrects--; } }
        } else if(sumDomainCorrects < overallCorrectTarget){
            const ordered = Object.keys(perDomainTargets).sort((a,b)=>(domainCounts[b]-perDomainTargets[b]) - (domainCounts[a]-perDomainTargets[a]));
            for(const k of ordered){ if(sumDomainCorrects >= overallCorrectTarget) break; if(perDomainTargets[k] < domainCounts[k]){ perDomainTargets[k]++; sumDomainCorrects++; } }
        }
        const correctIndexSet = new Set();
        ['people','process','business'].forEach(k => {
            const list = semanticDomains[k];
            const need = perDomainTargets[k];
            for(let i=0; i<list.length && i<need; i++) correctIndexSet.add(list[i]);
        });
        const startedAt = new Date(Date.now() - questionIds.length * 40000); // 40s médio
        let cumulativeSec = 0;
        const aprovMin = examType.PontuacaoMinimaPercent != null ? Number(examType.PontuacaoMinimaPercent) : null;
        const scorePercent = (correctIndexSet.size / questionIds.length * 100);
        const aprovado = aprovMin != null ? scorePercent >= aprovMin : null;
        let attemptId = null;

        const fixtureSpec = require('../config/fixtureSpec');
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
                Corretas: correctIndexSet.size,
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
                Meta: {
                    origin: 'fixture-endpoint',
                    domainPercentsRequested: { people: peopleVal, process: processVal, business: businessVal },
                    domainCounts,
                    domainCorrects: perDomainTargets,
                    domainPercentsActual: {
                        people: domainCounts.people ? (perDomainTargets.people / domainCounts.people * 100).toFixed(2) : null,
                        process: domainCounts.process ? (perDomainTargets.process / domainCounts.process * 100).toFixed(2) : null,
                        business: domainCounts.business ? (perDomainTargets.business / domainCounts.business * 100).toFixed(2) : null
                    },
                    domainPercentsDiff: {
                        people: (peopleVal!=null && domainCounts.people) ? ((perDomainTargets.people / domainCounts.people * 100) - peopleVal).toFixed(2) : null,
                        process: (processVal!=null && domainCounts.process) ? ((perDomainTargets.process / domainCounts.process * 100) - processVal).toFixed(2) : null,
                        business: (businessVal!=null && domainCounts.business) ? ((perDomainTargets.business / domainCounts.business * 100) - businessVal).toFixed(2) : null
                    },
                    fixtureVersion: fixtureSpec.fixtureVersion,
                    answerStrategy: fixtureSpec.answerStrategy
                },
                StatusReason: 'fixture-generated'
            }, { transaction: t });
            attemptId = attempt.Id;
            // Precarregar opções das questões para simular seleção real
            let optionMap = new Map();
            try {
                if (questionIds.length) {
                    const optRows = await db.sequelize.query(
                        `SELECT id as id, idquestao as qid, iscorreta as correta FROM respostaopcao WHERE idquestao IN (${questionIds.join(',')})`,
                        { type: db.Sequelize.QueryTypes.SELECT, transaction: t }
                    );
                    optRows.forEach(r => {
                        const arr = optionMap.get(r.qid) || [];
                        arr.push(r);
                        optionMap.set(r.qid, arr);
                    });
                }
            } catch(e){ console.warn('Falha carregar opções para fixture:', e.message); }

            const aqRows = [];
            const ansRows = [];
            questionIds.forEach((qid, idx) => {
                const isCorrect = correctIndexSet.has(idx);
                const tempo = 25 + Math.floor(Math.random()*55); // 25-80s
                cumulativeSec += tempo;
                const qUpdated = new Date(startedAt.getTime() + cumulativeSec*1000);
                aqRows.push({ AttemptId: attemptId, QuestionId: qid, Ordem: idx+1, TempoGastoSegundos: tempo, Correta: isCorrect, Meta: null, CreatedAt: startedAt, UpdatedAt: qUpdated });
            });
            const insertedQuestions = await db.ExamAttemptQuestion.bulkCreate(aqRows, { transaction: t, returning: true });

            // Criar respostas simulando seleção das opções corretas (ou uma incorreta) para refletir domínio no indicador IND10
            insertedQuestions.forEach(q => {
                const qOpts = optionMap.get(q.QuestionId) || [];
                const correctOpts = qOpts.filter(o => o.correta);
                const incorrectOpts = qOpts.filter(o => !o.correta);
                const isCorrect = q.Correta;
                if (isCorrect && correctOpts.length) {
                    // Seleciona todas as corretas para que chosen_count == correct_count
                    correctOpts.forEach(opt => {
                        ansRows.push({ AttemptQuestionId: q.Id, OptionId: opt.id, Resposta: { auto: true }, Selecionada: true, CreatedAt: startedAt, UpdatedAt: q.UpdatedAt });
                    });
                } else {
                    // Seleciona uma incorreta (ou nada se não houver) para marcar incorreta
                    if (incorrectOpts.length) {
                        ansRows.push({ AttemptQuestionId: q.Id, OptionId: incorrectOpts[0].id, Resposta: { auto: true }, Selecionada: true, CreatedAt: startedAt, UpdatedAt: q.UpdatedAt });
                    } else if (correctOpts.length) {
                        // fallback: escolher somente uma correta (não marcará correta se houver múltiplas corretas)
                        ansRows.push({ AttemptQuestionId: q.Id, OptionId: correctOpts[0].id, Resposta: { auto: true }, Selecionada: true, CreatedAt: startedAt, UpdatedAt: q.UpdatedAt });
                    } else {
                        // Sem opções carregadas: linha placeholder (OptionId null) para não deixar vazio
                        ansRows.push({ AttemptQuestionId: q.Id, OptionId: null, Resposta: { auto: true }, Selecionada: true, CreatedAt: startedAt, UpdatedAt: q.UpdatedAt });
                    }
                }
            });
            if (ansRows.length) await db.ExamAttemptAnswer.bulkCreate(ansRows, { transaction: t });
            const finishedAt = new Date(startedAt.getTime() + cumulativeSec*1000 + 3000);
            await db.ExamAttempt.update({ FinishedAt: finishedAt, LastActivityAt: finishedAt }, { where: { Id: attemptId }, transaction: t });
        });

        // Atualiza estatísticas (finished)
        try { const userStatsService = require('../services/UserStatsService')(db); await userStatsService.incrementFinished(uid, pct); } catch(err){ console.warn('incrementFinished falhou:', err.message); }

        return res.json({ attemptId, userId: uid, totalQuestions: questionIds.length, corretas: correctIndexSet.size, scorePercent: scorePercent.toFixed(2), domainCounts, domainCorrects: perDomainTargets });
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
