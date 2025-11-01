const db = require('../models');
const sequelize = require('../config/database');
const { User } = db;
// lightweight session id generator (no external dependency)
function genSessionId(){
  return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10);
}

// In-memory exam sessions (prototype only). Consider using Redis/DB in production.
const SESSIONS = new Map();
function putSession(sessionId, data, ttlMs = 6 * 60 * 60 * 1000) { // 6h TTL default
  const expiresAt = Date.now() + ttlMs;
  SESSIONS.set(sessionId, { ...data, expiresAt });
}
function getSession(sessionId) {
  const s = SESSIONS.get(sessionId);
  if (!s) return null;
  if (s.expiresAt && s.expiresAt < Date.now()) { SESSIONS.delete(sessionId); return null; }
  return s;
}
function updateSession(sessionId, patch) {
  const s = getSession(sessionId);
  if (!s) return null;
  const ns = { ...s, ...patch };
  SESSIONS.set(sessionId, ns);
  return ns;
}

// DB-backed exam types cache (5 min TTL)
let _examTypesCache = { data: null, expiresAt: 0 };
async function loadExamTypesFromDb() {
  try {
    if (Date.now() < _examTypesCache.expiresAt && Array.isArray(_examTypesCache.data)) return _examTypesCache.data;
    if (!db.ExamType) return null;
    const rows = await db.ExamType.findAll({ where: { Ativo: true }, order: [['Nome', 'ASC']] });
    const types = rows.map(r => ({
      id: r.Slug,
      nome: r.Nome,
      numeroQuestoes: r.NumeroQuestoes,
      duracaoMinutos: r.DuracaoMinutos,
      opcoesPorQuestao: r.OpcoesPorQuestao,
      multiplaSelecao: !!r.MultiplaSelecao,
      pontuacaoMinima: r.PontuacaoMinimaPercent == null ? null : Number(r.PontuacaoMinimaPercent),
      pausas: {
        permitido: !!r.PausaPermitida,
        checkpoints: Array.isArray(r.PausaCheckpoints) ? r.PausaCheckpoints : [],
        duracaoMinutosPorPausa: r.PausaDuracaoMinutos || 0,
      },
      _dbId: r.Id,
    }));
    _examTypesCache = { data: types, expiresAt: Date.now() + 5 * 60 * 1000 };
    return types;
  } catch (_) { return null; }
}
async function getExamTypeBySlugOrDefault(slug) {
  const registry = require('../services/exams/ExamRegistry');
  const types = await loadExamTypesFromDb();
  if (types && types.length) return types.find(t => t.id === slug) || types[0];
  const reg = registry.getTypeById(slug);
  return reg ? { ...reg, _dbId: null } : null;
}

exports.listExams = async (req, res) => {
  try {
    const types = await loadExamTypesFromDb();
    if (types && types.length) return res.json(types);
    const disableFallback = String(process.env.EXAM_TYPES_DISABLE_FALLBACK || '').toLowerCase() === 'true';
    if (disableFallback) {
      return res.status(404).json({ error: 'No exam types configured in DB' });
    }
    const registry = require('../services/exams/ExamRegistry');
    return res.json(registry.getTypes());
  } catch (err) {
    console.error('Erro listExams:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
};

// GET /api/exams/types -> returns configured exam types (for UI)
exports.listExamTypes = async (_req, res) => {
  try {
    const types = await loadExamTypesFromDb();
    if (types && types.length) return res.json(types);
    const disableFallback = String(process.env.EXAM_TYPES_DISABLE_FALLBACK || '').toLowerCase() === 'true';
    if (disableFallback) {
      return res.status(404).json({ error: 'No exam types configured in DB' });
    }
    const registry = require('../services/exams/ExamRegistry');
    return res.json(registry.getTypes());
  } catch (err) {
    console.error('Erro listExamTypes:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
};

// POST /api/exams/select
// Body: { count: number, dominios?: [ids], areas?: [ids], grupos?: [ids] }
exports.selectQuestions = async (req, res) => {
  try {
  const examType = (req.body && req.body.examType) || (req.get('X-Exam-Type') || '').trim() || 'pmp';
  const examCfg = await getExamTypeBySlugOrDefault(examType);
  let count = Number((req.body && req.body.count) || 0) || 0;
    if (!count || count <= 0) return res.status(400).json({ error: 'count required' });

    // resolve user via X-Session-Token (same logic as /api/auth/me)
    const sessionToken = (req.get('X-Session-Token') || req.body.sessionToken || '').trim();
    if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });

    let user = null;
    if (/^\d+$/.test(sessionToken)) {
      user = await User.findByPk(Number(sessionToken));
    }
    if (!user) {
      const Op = db.Sequelize && db.Sequelize.Op;
      const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
      user = await User.findOne({ where });
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bloqueio = Boolean(user.BloqueioAtivado);
    // Enforce hard cap for blocked users
    if (bloqueio && count > 25) {
      count = 25;
    }

  // Optional filters
  const dominios = Array.isArray(req.body.dominios) && req.body.dominios.length ? req.body.dominios.map(Number) : null;
  const areas = Array.isArray(req.body.areas) && req.body.areas.length ? req.body.areas.map(Number) : null;
  const grupos = Array.isArray(req.body.grupos) && req.body.grupos.length ? req.body.grupos.map(Number) : null;

  // Build WHERE clause
  const whereClauses = [`excluido = false`, `idstatus = 1`];
  if (bloqueio) whereClauses.push(`seed = true`);
  // AND semantics across tabs; OR within each list
  // i.e., if user chose dominios AND grupos, a question must match both a selected domínio AND a selected grupo
  if (dominios && dominios.length) whereClauses.push(`iddominio IN (${dominios.join(',')})`);
  if (areas && areas.length) whereClauses.push(`codareaconhecimento IN (${areas.join(',')})`);
  if (grupos && grupos.length) whereClauses.push(`codgrupoprocesso IN (${grupos.join(',')})`);
  const whereSql = whereClauses.join(' AND ');

    // Count available
  const countQuery = `SELECT COUNT(*)::int AS cnt FROM questao WHERE ${whereSql}`;
    const countRes = await sequelize.query(countQuery, { type: sequelize.QueryTypes.SELECT });
    const available = (countRes && countRes[0] && Number(countRes[0].cnt)) || 0;
    // Support preflight count-only check
    const onlyCount = Boolean(req.body && req.body.onlyCount) || String(req.query && req.query.onlyCount).toLowerCase() === 'true';
    if (onlyCount) {
      return res.json({ available });
    }
    if (available < count) {
      return res.status(400).json({ error: 'Not enough questions available', available });
    }
    // Select random questions and join explicacaoguia to get the explanation text
    // explicacaoguia.Descricao contains the explicacao and links by idquestao -> questao.id
    const selectQ = `SELECT q.id, q.descricao, eg."Descricao" AS explicacao
      FROM questao q
      LEFT JOIN explicacaoguia eg ON eg.idquestao = q.id AND (eg."Excluido" = false OR eg."Excluido" IS NULL)
      WHERE ${whereSql}
      ORDER BY random()
      LIMIT :limit`;
    const questions = await sequelize.query(selectQ, { replacements: { limit: count }, type: sequelize.QueryTypes.SELECT });

    const ids = questions.map(q => q.id);

    // Fetch options for selected questions (exclude excluded options)
    let options = [];
    if (ids.length) {
      // Use the actual table/column names for RespostaOpcao (case-sensitive in this DB)
      const optsQ = `SELECT "Id" AS id, "IdQuestao" AS idquestao, "Descricao" AS descricao, "IsCorreta" AS iscorreta
        FROM respostaopcao
        WHERE ("Excluido" = false OR "Excluido" IS NULL) AND "IdQuestao" IN (:ids)
        ORDER BY random()`;
      options = await sequelize.query(optsQ, { replacements: { ids }, type: sequelize.QueryTypes.SELECT });
    }

    // group options by question id
    const optsByQ = {};
    options.forEach(o => {
      const qid = o.idquestao || o.IdQuestao || o.IdQuestao;
      if (!optsByQ[qid]) optsByQ[qid] = [];
      // do not include iscorreta in payload
      optsByQ[qid].push({ id: o.id || o.Id, descricao: o.descricao || o.Descricao });
    });

    // assemble payload
    const payloadQuestions = questions.map(q => ({
      id: q.id || q.Id,
      descricao: q.descricao || q.Descricao,
      explicacao: q.explicacao || q.Explicacao,
      options: optsByQ[q.id] || []
    }));

    // generate temporary session id (not persisted yet)
    const sessionId = genSessionId();

    // Note: persistence to Simulation and simulation_questions is intentionally left commented for later activation.

    // Include minimal exam blueprint for the client when selecting inline
    const blueprint = {
      id: examCfg.id,
      nome: examCfg.nome,
      numeroQuestoes: examCfg.numeroQuestoes,
      duracaoMinutos: examCfg.duracaoMinutos,
      pausas: examCfg.pausas,
      opcoesPorQuestao: examCfg.opcoesPorQuestao,
      multiplaSelecao: examCfg.multiplaSelecao,
    };

    return res.json({ sessionId, total: payloadQuestions.length, examType: examCfg.id, exam: blueprint, questions: payloadQuestions });
  } catch (err) {
    console.error('Erro selectQuestions:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// Placeholder for starting a persisted exam/session (not implemented yet)
exports.startExam = async (req, res) => {
  try {
    return res.status(501).json({ message: 'startExam not implemented yet' });
  } catch (err) {
    console.error('Erro startExam:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
};

// POST /api/exams/submit
// Body: { sessionId: string, answers: [{ questionId: number, optionId?: number, optionIds?: number[] }] }
exports.submitAnswers = async (req, res) => {
  try {
    const sessionToken = (req.get('X-Session-Token') || req.body.sessionToken || '').trim();
    if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });

    // resolve user (same as other endpoints)
    let user = null;
    if (/^\d+$/.test(sessionToken)) {
      user = await User.findByPk(Number(sessionToken));
    }
    if (!user) {
      const Op = db.Sequelize && db.Sequelize.Op;
      const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
      user = await User.findOne({ where });
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

  const { sessionId, answers } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    if (!Array.isArray(answers) || !answers.length) return res.status(400).json({ error: 'answers required' });
  const s = getSession(sessionId);
  const attemptId = s && s.attemptId ? Number(s.attemptId) : null;

    // collect question ids
    const qids = Array.from(new Set(answers.map(a => Number(a.questionId)).filter(n => !Number.isNaN(n))));
    if (!qids.length) return res.status(400).json({ error: 'no valid questionIds' });

    // fetch correct option ids from respostaopcao
    const correctQ = `SELECT "Id" AS id, "IdQuestao" AS idquestao
      FROM respostaopcao
      WHERE "IsCorreta" = true AND "IdQuestao" IN (:qids)`;
    const correctRows = await sequelize.query(correctQ, { replacements: { qids }, type: sequelize.QueryTypes.SELECT });

    const correctByQ = {};
    (correctRows || []).forEach(r => {
      if (r && (r.id || r.Id) && (r.idquestao || r.IdQuestao)) {
        correctByQ[Number(r.idquestao || r.IdQuestao)] = Number(r.id || r.Id);
      }
    });

    // grade (single or multi)
    let totalCorrect = 0;
    const details = answers.map(a => {
      const qid = Number(a.questionId);
      let ok = false;
      if (Array.isArray(a.optionIds)) {
        const chosenSet = new Set((a.optionIds || []).map(Number));
        const correctSet = new Set([correctByQ[qid]].filter(Boolean));
        ok = chosenSet.size === correctSet.size && [...chosenSet].every(x => correctSet.has(x));
      } else {
        const chosen = Number(a.optionId);
        const correctOpt = correctByQ[qid] || null;
        ok = !!(correctOpt && chosen === correctOpt);
      }
      if (ok) totalCorrect += 1;
      return { questionId: qid, chosenOptionId: Number(a.optionId) || null, correct: ok };
    });

    const result = { sessionId, totalQuestions: qids.length, totalCorrect, details };

    // Persist answers if we have an attempt
    try {
      if (attemptId) {
        const aqRows = await db.ExamAttemptQuestion.findAll({ where: { AttemptId: attemptId, QuestionId: qids } });
        const aqMap = new Map(aqRows.map(r => [Number(r.QuestionId), Number(r.Id)]));
        const toInsert = [];
        for (const a of answers) {
          const qid = Number(a.questionId);
          const aqid = aqMap.get(qid);
          if (!aqid) continue;
          if (Array.isArray(a.optionIds)) {
            for (const oid of a.optionIds) {
              const optId = Number(oid);
              if (!Number.isNaN(optId)) toInsert.push({ AttemptQuestionId: aqid, OptionId: optId });
            }
          } else {
            const optId = Number(a.optionId);
            if (!Number.isNaN(optId)) toInsert.push({ AttemptQuestionId: aqid, OptionId: optId });
          }
        }
        if (toInsert.length) await db.ExamAttemptAnswer.bulkCreate(toInsert, { ignoreDuplicates: true });

        // Score and finish attempt
        const examSlug = (s && s.examType) || 'pmp';
        const examCfg = await getExamTypeBySlugOrDefault(examSlug);
        const percent = qids.length ? (totalCorrect * 100.0) / qids.length : 0;
        const aprovado = (examCfg && examCfg.pontuacaoMinima != null) ? (percent >= Number(examCfg.pontuacaoMinima)) : null;
        await db.ExamAttempt.update({
          Corretas: totalCorrect,
          Total: qids.length,
          ScorePercent: percent,
          Aprovado: aprovado,
          Status: 'finished',
          FinishedAt: new Date(),
        }, { where: { Id: attemptId } });
      }
    } catch (e) { console.warn('submitAnswers persistence warning:', e); }

    return res.json(result);
  } catch (err) {
    console.error('Erro submitAnswers:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// POST /api/exams/start-on-demand
// Body: { count, filters... }
// Returns { sessionId, total }
exports.startOnDemand = async (req, res) => {
  try {
    const examType = (req.body && req.body.examType) || (req.get('X-Exam-Type') || '').trim() || 'pmp';
    const examCfg = await getExamTypeBySlugOrDefault(examType);
    let count = Number((req.body && req.body.count) || 0) || 0;
    if (!count || count <= 0) return res.status(400).json({ error: 'count required' });
    const sessionToken = (req.get('X-Session-Token') || req.body.sessionToken || '').trim();
    if (!sessionToken) return res.status(400).json({ error: 'X-Session-Token required' });

    let user = null;
    if (/^\d+$/.test(sessionToken)) user = await User.findByPk(Number(sessionToken));
    if (!user) {
      const Op = db.Sequelize && db.Sequelize.Op;
      const where = Op ? { [Op.or]: [{ NomeUsuario: sessionToken }, { Email: sessionToken }] } : { NomeUsuario: sessionToken };
      user = await User.findOne({ where });
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bloqueio = Boolean(user.BloqueioAtivado);
    if (bloqueio && count > 25) count = 25;

    const dominios = Array.isArray(req.body.dominios) && req.body.dominios.length ? req.body.dominios.map(Number) : null;
    const areas = Array.isArray(req.body.areas) && req.body.areas.length ? req.body.areas.map(Number) : null;
    const grupos = Array.isArray(req.body.grupos) && req.body.grupos.length ? req.body.grupos.map(Number) : null;
    const whereClauses = [`excluido = false`, `idstatus = 1`];
    if (bloqueio) whereClauses.push(`seed = true`);
    if (dominios && dominios.length) whereClauses.push(`iddominio IN (${dominios.join(',')})`);
    if (areas && areas.length) whereClauses.push(`codareaconhecimento IN (${areas.join(',')})`);
    if (grupos && grupos.length) whereClauses.push(`codgrupoprocesso IN (${grupos.join(',')})`);
    const whereSql = whereClauses.join(' AND ');

    const countQuery = `SELECT COUNT(*)::int AS cnt FROM questao WHERE ${whereSql}`;
    const countRes = await sequelize.query(countQuery, { type: sequelize.QueryTypes.SELECT });
    const available = (countRes && countRes[0] && Number(countRes[0].cnt)) || 0;
    if (available < count) return res.status(400).json({ error: 'Not enough questions available', available });

    const selectIdsQ = `SELECT q.id FROM questao q WHERE ${whereSql} ORDER BY random() LIMIT :limit`;
    const rows = await sequelize.query(selectIdsQ, { replacements: { limit: count }, type: sequelize.QueryTypes.SELECT });
    const questionIds = rows.map(r => r.id || r.Id);
    const sessionId = genSessionId();
    // initialize pause state based on policy
    const policy = examCfg.pausas || { permitido: false, checkpoints: [], duracaoMinutosPorPausa: 0 };
    const pauseState = { pauseUntil: 0, consumed: {} };
    (policy.checkpoints || []).forEach((cp) => { pauseState.consumed[cp] = false; });

    // Persist attempt and ordered questions
    const orm = db.sequelize;
    let attempt = null;
    await orm.transaction(async (t) => {
      attempt = await db.ExamAttempt.create({
        UserId: user.Id || user.id,
        ExamTypeId: examCfg._dbId || null,
        Modo: 'on-demand',
        QuantidadeQuestoes: questionIds.length,
        StartedAt: new Date(),
        Status: 'in_progress',
        PauseState: pauseState,
        BlueprintSnapshot: {
          id: examCfg.id,
          nome: examCfg.nome,
          numeroQuestoes: examCfg.numeroQuestoes,
          duracaoMinutos: examCfg.duracaoMinutos,
          pausas: policy,
          opcoesPorQuestao: examCfg.opcoesPorQuestao,
          multiplaSelecao: examCfg.multiplaSelecao,
          pontuacaoMinima: examCfg.pontuacaoMinima ?? null,
        },
        FiltrosUsados: { dominios, areas, grupos },
      }, { transaction: t });
      if (attempt && questionIds.length) {
        const rows = questionIds.map((qid, idx) => ({ AttemptId: attempt.Id, QuestionId: qid, Ordem: idx + 1 }));
        await db.ExamAttemptQuestion.bulkCreate(rows, { transaction: t });
      }
    });

    putSession(sessionId, {
      userId: user.Id || user.id,
      examType: examCfg.id,
      examTypeId: examCfg._dbId || null,
      attemptId: attempt ? attempt.Id : null,
      questionIds,
      pausePolicy: policy,
      pauses: pauseState,
    });

    return res.json({ sessionId, total: questionIds.length, examType: examCfg.id, attemptId: attempt ? attempt.Id : null, exam: {
      id: examCfg.id,
      nome: examCfg.nome,
      numeroQuestoes: examCfg.numeroQuestoes,
      duracaoMinutos: examCfg.duracaoMinutos,
      pausas: policy,
      opcoesPorQuestao: examCfg.opcoesPorQuestao,
      multiplaSelecao: examCfg.multiplaSelecao,
    }});
  } catch (err) {
    console.error('Erro startOnDemand:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// GET /api/exams/:sessionId/question/:index
exports.getQuestion = async (req, res) => {
  try {
    const { sessionId, index } = { sessionId: req.params.sessionId, index: Number(req.params.index) };
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    if (!Number.isInteger(index) || index < 0 || index >= s.questionIds.length) return res.status(400).json({ error: 'invalid index' });
    const qid = s.questionIds[index];
    const qQ = `SELECT q.id, q.descricao, eg."Descricao" AS explicacao FROM questao q LEFT JOIN explicacaoguia eg ON eg.idquestao = q.id AND (eg."Excluido" = false OR eg."Excluido" IS NULL) WHERE q.id = :id LIMIT 1`;
    const qRows = await sequelize.query(qQ, { replacements: { id: qid }, type: sequelize.QueryTypes.SELECT });
    if (!qRows || !qRows.length) return res.status(404).json({ error: 'question not found' });
    const q = qRows[0];
    const optsQ = `SELECT "Id" AS id, "IdQuestao" AS idquestao, "Descricao" AS descricao FROM respostaopcao WHERE ("Excluido" = false OR "Excluido" IS NULL) AND "IdQuestao" = :qid ORDER BY random()`;
    const opts = await sequelize.query(optsQ, { replacements: { qid }, type: sequelize.QueryTypes.SELECT });
    return res.json({ index, total: s.questionIds.length, examType: s.examType || 'pmp', question: { id: q.id, descricao: q.descricao || q.Descricao, explicacao: q.explicacao || q.Explicacao, options: opts } });
  } catch (err) {
    console.error('Erro getQuestion:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// POST /api/exams/:sessionId/pause/start { index }
exports.pauseStart = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const index = Number(req.body && req.body.index);
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    if (!Number.isInteger(index)) return res.status(400).json({ error: 'index required' });
    const policy = s.pausePolicy || { permitido: false, checkpoints: [], duracaoMinutosPorPausa: 0 };
    if (!policy.permitido) return res.status(400).json({ error: 'pause not permitted for this exam' });
    const cps = Array.isArray(policy.checkpoints) ? policy.checkpoints : [];
    if (!cps.includes(index)) return res.status(400).json({ error: 'pause not allowed at this index' });
    const consumed = s.pauses && s.pauses.consumed ? s.pauses.consumed : {};
    if (consumed[index]) return res.status(400).json({ error: 'pause already consumed' });
    const ms = (Number(policy.duracaoMinutosPorPausa) || 0) * 60 * 1000;
    const until = Date.now() + ms;
    consumed[index] = true;
    updateSession(sessionId, { pauses: { ...s.pauses, pauseUntil: until, consumed }, pausePolicy: policy });
    return res.json({ ok: true, pauseUntil: until });
  } catch (err) {
    console.error('Erro pauseStart:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// POST /api/exams/:sessionId/pause/skip { index }
exports.pauseSkip = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const index = Number(req.body && req.body.index);
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    if (!Number.isInteger(index)) return res.status(400).json({ error: 'index required' });
    const policy = s.pausePolicy || { permitido: false, checkpoints: [], duracaoMinutosPorPausa: 0 };
    const cps = Array.isArray(policy.checkpoints) ? policy.checkpoints : [];
    if (!cps.includes(index)) return res.status(400).json({ error: 'skip not allowed at this index' });
    const consumed = s.pauses && s.pauses.consumed ? s.pauses.consumed : {};
    if (consumed[index]) return res.status(200).json({ ok: true, already: true });
    consumed[index] = true;
    updateSession(sessionId, { pauses: { ...s.pauses, consumed } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro pauseSkip:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

// GET /api/exams/:sessionId/pause/status
exports.pauseStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    return res.json({ pauses: s.pauses || {}, policy: s.pausePolicy || null, examType: s.examType || 'pmp' });
  } catch (err) {
    console.error('Erro pauseStatus:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};