const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/requireAdmin');
const examController = require('../controllers/examController');
const db = require('../models');
const { ExamAttempt, ExamAttemptPurgeLog, ExamAttemptUserStats } = db;
const { Op } = require('sequelize');
const { badRequest, internalError, notFound } = require('../middleware/errors');

// Admin-only endpoints for lifecycle management
// Lightweight probe endpoint for front-end admin menu detection (returns 204 if admin)
router.get('/probe', requireAdmin, (req, res) => res.status(204).end());

// Exam content (ECO) versioning admin endpoints
// GET /api/admin/exams/content-versions?examTypeId=1
// Returns all known versions for an exam type and the currently selected default.
router.get('/content-versions', requireAdmin, async (req, res, next) => {
    try {
        const examTypeId = Number(req.query && req.query.examTypeId);
        if (!Number.isFinite(examTypeId) || examTypeId <= 0) {
            return next(badRequest('examTypeId inválido', 'EXAM_TYPE_ID_INVALID'));
        }

        const versions = await db.sequelize.query(
            `SELECT id, exam_type_id AS "examTypeId", code, effective_from AS "effectiveFrom", notes
               FROM exam_content_version
              WHERE exam_type_id = :examTypeId
              ORDER BY effective_from DESC NULLS LAST, id DESC`,
            { replacements: { examTypeId }, type: db.Sequelize.QueryTypes.SELECT }
        );

        let currentVersionId = null;
        try {
            const cv = await db.sequelize.query(
                `SELECT exam_content_version_id AS id
                   FROM exam_content_current_version
                  WHERE exam_type_id = :examTypeId
                  LIMIT 1`,
                { replacements: { examTypeId }, type: db.Sequelize.QueryTypes.SELECT }
            );
            if (Array.isArray(cv) && cv[0] && cv[0].id != null) {
                const n = Number(cv[0].id);
                if (Number.isFinite(n) && n > 0) currentVersionId = n;
            }
        } catch (_) {
            // table may not exist yet
        }

        return res.json({ examTypeId, currentVersionId, versions: Array.isArray(versions) ? versions : [] });
    } catch (err) {
        return next(internalError('Erro ao listar versões de conteúdo', 'ADMIN_LIST_CONTENT_VERSIONS_ERROR', err));
    }
});

// PUT /api/admin/exams/content-current
// Body: { examTypeId, examContentVersionId }
router.put('/content-current', requireAdmin, express.json(), async (req, res, next) => {
    try {
        const examTypeId = Number(req.body && req.body.examTypeId);
        const examContentVersionId = Number(req.body && req.body.examContentVersionId);
        if (!Number.isFinite(examTypeId) || examTypeId <= 0) {
            return next(badRequest('examTypeId inválido', 'EXAM_TYPE_ID_INVALID'));
        }
        if (!Number.isFinite(examContentVersionId) || examContentVersionId <= 0) {
            return next(badRequest('examContentVersionId inválido', 'EXAM_CONTENT_VERSION_ID_INVALID'));
        }

        // Validate version exists and matches exam type
        const v = await db.sequelize.query(
            `SELECT id, exam_type_id AS "examTypeId", code, effective_from AS "effectiveFrom", notes
               FROM exam_content_version
              WHERE id = :id
              LIMIT 1`,
            { replacements: { id: examContentVersionId }, type: db.Sequelize.QueryTypes.SELECT }
        );
        const versionRow = Array.isArray(v) ? v[0] : null;
        if (!versionRow) return next(notFound('Versão de conteúdo não encontrada', 'EXAM_CONTENT_VERSION_NOT_FOUND'));
        if (Number(versionRow.examTypeId) !== examTypeId) {
            return next(badRequest('Versão não pertence ao examTypeId informado', 'EXAM_CONTENT_VERSION_TYPE_MISMATCH'));
        }

        await db.sequelize.query(
            `INSERT INTO exam_content_current_version (exam_type_id, exam_content_version_id, updated_at)
             VALUES (:examTypeId, :examContentVersionId, NOW())
             ON CONFLICT (exam_type_id)
             DO UPDATE SET exam_content_version_id = EXCLUDED.exam_content_version_id, updated_at = NOW()`,
            { replacements: { examTypeId, examContentVersionId }, type: db.Sequelize.QueryTypes.INSERT }
        );

        return res.json({ ok: true, examTypeId, currentVersionId: examContentVersionId, version: versionRow });
    } catch (err) {
        return next(internalError('Erro ao definir versão atual de conteúdo', 'ADMIN_SET_CURRENT_CONTENT_VERSION_ERROR', err));
    }
});

// GET /api/admin/exams/user-content-version?userId=123&examTypeId=1
// Returns the active per-user override for the exam type (if any)
router.get('/user-content-version', requireAdmin, async (req, res, next) => {
    try {
        const userId = Number(req.query && req.query.userId);
        const examTypeId = Number(req.query && req.query.examTypeId);
        if (!Number.isFinite(userId) || userId <= 0) {
            return next(badRequest('userId inválido', 'USER_ID_INVALID'));
        }
        if (!Number.isFinite(examTypeId) || examTypeId <= 0) {
            return next(badRequest('examTypeId inválido', 'EXAM_TYPE_ID_INVALID'));
        }

        const rows = await db.sequelize.query(
            `SELECT id,
                    user_id AS "userId",
                    exam_type_id AS "examTypeId",
                    exam_content_version_id AS "examContentVersionId",
                    active,
                    starts_at AS "startsAt",
                    ends_at AS "endsAt",
                    source,
                    external_reference AS "externalReference",
                    notes,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
               FROM user_exam_content_version
              WHERE user_id = :userId
                AND exam_type_id = :examTypeId
                AND active = TRUE
                AND (starts_at IS NULL OR starts_at <= NOW())
                AND (ends_at IS NULL OR ends_at > NOW())
              ORDER BY id DESC
              LIMIT 1`,
            { replacements: { userId, examTypeId }, type: db.Sequelize.QueryTypes.SELECT }
        );
        return res.json({ userId, examTypeId, override: (Array.isArray(rows) && rows[0]) ? rows[0] : null });
    } catch (err) {
        return next(internalError('Erro ao consultar override do usuário', 'ADMIN_GET_USER_CONTENT_VERSION_ERROR', err));
    }
});

// PUT /api/admin/exams/user-content-version
// Body: { userId, examTypeId, examContentVersionId, startsAt?, endsAt?, source?, externalReference?, notes? }
router.put('/user-content-version', requireAdmin, express.json(), async (req, res, next) => {
    try {
        const userId = Number(req.body && req.body.userId);
        const examTypeId = Number(req.body && req.body.examTypeId);
        const examContentVersionId = Number(req.body && req.body.examContentVersionId);
        const startsAt = (req.body && req.body.startsAt) ? String(req.body.startsAt) : null;
        const endsAt = (req.body && req.body.endsAt) ? String(req.body.endsAt) : null;
        const source = (req.body && req.body.source) ? String(req.body.source) : 'admin';
        const externalReference = (req.body && req.body.externalReference) ? String(req.body.externalReference) : null;
        const notes = (req.body && req.body.notes) ? String(req.body.notes) : null;

        if (!Number.isFinite(userId) || userId <= 0) {
            return next(badRequest('userId inválido', 'USER_ID_INVALID'));
        }
        if (!Number.isFinite(examTypeId) || examTypeId <= 0) {
            return next(badRequest('examTypeId inválido', 'EXAM_TYPE_ID_INVALID'));
        }
        if (!Number.isFinite(examContentVersionId) || examContentVersionId <= 0) {
            return next(badRequest('examContentVersionId inválido', 'EXAM_CONTENT_VERSION_ID_INVALID'));
        }

        // Validate user exists
        const user = await db.User.findByPk(userId);
        if (!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));

        // Validate version exists and matches exam type
        const v = await db.sequelize.query(
            `SELECT id, exam_type_id AS "examTypeId", code, effective_from AS "effectiveFrom", notes
               FROM exam_content_version
              WHERE id = :id
              LIMIT 1`,
            { replacements: { id: examContentVersionId }, type: db.Sequelize.QueryTypes.SELECT }
        );
        const versionRow = Array.isArray(v) ? v[0] : null;
        if (!versionRow) return next(notFound('Versão de conteúdo não encontrada', 'EXAM_CONTENT_VERSION_NOT_FOUND'));
        if (Number(versionRow.examTypeId) !== examTypeId) {
            return next(badRequest('Versão não pertence ao examTypeId informado', 'EXAM_CONTENT_VERSION_TYPE_MISMATCH'));
        }

        let insertedRow = null;
        await db.sequelize.transaction(async (t) => {
            // Deactivate any existing active overrides for the pair
            await db.sequelize.query(
                `UPDATE user_exam_content_version
                    SET active = FALSE,
                        updated_at = NOW()
                  WHERE user_id = :userId
                    AND exam_type_id = :examTypeId
                    AND active = TRUE`,
                { replacements: { userId, examTypeId }, type: db.Sequelize.QueryTypes.UPDATE, transaction: t }
            );

            const rows = await db.sequelize.query(
                `INSERT INTO user_exam_content_version (
                    user_id, exam_type_id, exam_content_version_id,
                    active, starts_at, ends_at, source, external_reference, notes,
                    created_at, updated_at
                 ) VALUES (
                    :userId, :examTypeId, :examContentVersionId,
                    TRUE,
                    CASE WHEN :startsAt IS NULL OR :startsAt = '' THEN NULL ELSE :startsAt::timestamptz END,
                    CASE WHEN :endsAt IS NULL OR :endsAt = '' THEN NULL ELSE :endsAt::timestamptz END,
                    :source, :externalReference, :notes,
                    NOW(), NOW()
                 )
                 RETURNING id,
                           user_id AS "userId",
                           exam_type_id AS "examTypeId",
                           exam_content_version_id AS "examContentVersionId",
                           active,
                           starts_at AS "startsAt",
                           ends_at AS "endsAt",
                           source,
                           external_reference AS "externalReference",
                           notes,
                           created_at AS "createdAt",
                           updated_at AS "updatedAt"`,
                {
                    replacements: { userId, examTypeId, examContentVersionId, startsAt, endsAt, source, externalReference, notes },
                    type: db.Sequelize.QueryTypes.SELECT,
                    transaction: t
                }
            );
            insertedRow = (Array.isArray(rows) && rows[0]) ? rows[0] : null;
        });

        return res.json({ ok: true, userId, examTypeId, override: insertedRow, version: versionRow });
    } catch (err) {
        return next(internalError('Erro ao definir override do usuário', 'ADMIN_SET_USER_CONTENT_VERSION_ERROR', err));
    }
});

// DELETE /api/admin/exams/user-content-version?userId=123&examTypeId=1
// Deactivates the active override (falls back to default/current)
router.delete('/user-content-version', requireAdmin, async (req, res, next) => {
    try {
        const userId = Number(req.query && req.query.userId);
        const examTypeId = Number(req.query && req.query.examTypeId);
        if (!Number.isFinite(userId) || userId <= 0) {
            return next(badRequest('userId inválido', 'USER_ID_INVALID'));
        }
        if (!Number.isFinite(examTypeId) || examTypeId <= 0) {
            return next(badRequest('examTypeId inválido', 'EXAM_TYPE_ID_INVALID'));
        }

        await db.sequelize.query(
            `UPDATE user_exam_content_version
                SET active = FALSE,
                    updated_at = NOW()
              WHERE user_id = :userId
                AND exam_type_id = :examTypeId
                AND active = TRUE`,
            { replacements: { userId, examTypeId }, type: db.Sequelize.QueryTypes.UPDATE }
        );

        return res.json({ ok: true, userId, examTypeId });
    } catch (err) {
        return next(internalError('Erro ao limpar override do usuário', 'ADMIN_CLEAR_USER_CONTENT_VERSION_ERROR', err));
    }
});

router.post('/mark-abandoned', requireAdmin, examController.markAbandonedAttempts);
router.post('/purge-abandoned', requireAdmin, examController.purgeAbandonedAttempts);

// POST /api/admin/exams/fixture-attempt
// Body: { userId, overallPct, totalQuestions, examTypeSlug, peoplePct?, processPct?, businessPct? }
// Cria tentativa finalizada diretamente (fixture) para testes sem percorrer questões.
// NOTE: Mounted at /api/admin/exams, so path here must NOT repeat '/exams'
router.post('/fixture-attempt', requireAdmin, async (req, res, next) => {
    try {
        const { userId, overallPct = 65, totalQuestions = 180, examTypeSlug = 'pmp', peoplePct, processPct, businessPct } = req.body || {};
        if(!userId) return next(badRequest('userId obrigatório', 'USER_ID_REQUIRED'));
        const uid = Number(userId);
        if(!Number.isFinite(uid) || uid <= 0) return next(badRequest('userId inválido', 'USER_ID_INVALID'));
        const user = await db.User.findByPk(uid);
        if(!user) return next(notFound('Usuário não encontrado', 'USER_NOT_FOUND'));
        const examType = await db.ExamType.findOne({ where: { Slug: examTypeSlug } });
        if(!examType) return next(notFound('ExamType não encontrado', 'EXAM_TYPE_NOT_FOUND'));
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
            if(!Number.isFinite(tolerance) || tolerance < 0) return next(badRequest('Tolerance inválida', 'TOLERANCE_INVALID'));
            const diff = Math.abs(meanDom - pct);
            if(diff > tolerance){
                return next(badRequest('Incoerência de percentuais por domínio', 'DOMAIN_PERCENTS_INCOHERENT', { meanDom: meanDom.toFixed(2), overall: pct.toFixed(2), diff: diff.toFixed(2), tolerance }));
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
        if(questionIds.length < qt) return next(badRequest('Quantidade de questões insuficiente', 'INSUFFICIENT_QUESTIONS', { available: questionIds.length }));
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
        return next(internalError('Internal error', 'FIXTURE_ATTEMPT_ERROR', err));
    }
});

/**
 * POST /api/admin/reconcile-stats
 * Reconciliação de estatísticas de usuários
 * Query params: from, to, mode (rebuild|merge), dryRun (true|false)
 */
router.post('/reconcile-stats', requireAdmin, async (req, res, next) => {
    try {
        const { from, to, mode = 'rebuild', dryRun = 'false' } = req.query;
        
        if (!from || !to) {
            return next(badRequest('Parâmetros from e to são obrigatórios (formato YYYY-MM-DD)', 'DATE_RANGE_REQUIRED'));
        }
        
        const fromDate = new Date(from);
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            return next(badRequest('Datas inválidas', 'DATES_INVALID'));
        }
        
        if (fromDate > toDate) {
            return next(badRequest('Data inicial deve ser anterior à data final', 'DATE_ORDER_INVALID'));
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
        return next(internalError('Erro interno', 'RECONCILE_STATS_ERROR', err));
    }
});

module.exports = router;
