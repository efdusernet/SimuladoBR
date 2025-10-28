const db = require('../models');
const sequelize = require('../config/database');
const { User } = db;
// lightweight session id generator (no external dependency)
function genSessionId(){
  return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10);
}

exports.listExams = async (req, res) => {
  try {
    const Exam = require('../models/Exam');
    const exams = await Exam.findAll();
    return res.json(exams);
  } catch (err) {
    console.error('Erro listExams:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
};

// POST /api/exams/select
// Body: { count: number, dominios?: [ids] }
exports.selectQuestions = async (req, res) => {
  try {
  const count = Number((req.body && req.body.count) || 0) || 0;
  if (!count || count <= 0) return res.status(400).json({ error: 'count required' });
  if (count > 180) return res.status(400).json({ error: 'count must be <= 180' });

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

  // Optional filters
  const dominios = Array.isArray(req.body.dominios) && req.body.dominios.length ? req.body.dominios.map(Number) : null;
  const codareaconhecimento = Array.isArray(req.body.codareaconhecimento) && req.body.codareaconhecimento.length ? req.body.codareaconhecimento.map(Number) : null;
  const codgrupoprocesso = Array.isArray(req.body.codgrupoprocesso) && req.body.codgrupoprocesso.length ? req.body.codgrupoprocesso.map(Number) : null;

    // Build WHERE clause
    const whereClauses = [`excluido = false`, `idstatus = 1`];
    if (bloqueio) whereClauses.push(`seed = true`);
  if (dominios) whereClauses.push(`iddominio IN (${dominios.map(d => Number(d)).join(',')})`);
  if (codareaconhecimento) whereClauses.push(`codareaconhecimento IN (${codareaconhecimento.map(d => Number(d)).join(',')})`);
  if (codgrupoprocesso) whereClauses.push(`codgrupoprocesso IN (${codgrupoprocesso.map(d => Number(d)).join(',')})`);
    const whereSql = whereClauses.join(' AND ');

    // Count available
  const countQuery = `SELECT COUNT(*)::int AS cnt FROM questao WHERE ${whereSql}`;
    const countRes = await sequelize.query(countQuery, { type: sequelize.QueryTypes.SELECT });
    const available = (countRes && countRes[0] && Number(countRes[0].cnt)) || 0;
    if (available < count) {
      return res.status(400).json({ error: 'Not enough questions available', available });
    }


    // Select random questions and join explicacaoguia to get the explanation text
    // We attempt to detect the actual column name used for the multiplia/escolha flag
    // because some DBs may have different casing or underscores. Query information_schema
    // to find a suitable column; fall back to returning false when not present.
    const candidateNames = ['multipliaescolha','multiplia_escolha','multipliaEscolha','multiplia_escolha'];
    let chosenCol = null;
    try {
      const colsQ = `SELECT column_name FROM information_schema.columns WHERE table_name = 'questao' AND column_name = ANY(:candidates)`;
      const cols = await sequelize.query(colsQ, { replacements: { candidates: candidateNames }, type: sequelize.QueryTypes.SELECT });
      if (Array.isArray(cols) && cols.length) {
        // pick first match
        chosenCol = cols[0].column_name;
      }
    } catch (e) {
      // ignore - we'll treat as not found
    }

    // helper to produce column expression (quote if needed)
    const colExpr = chosenCol ? (/^[a-z0-9_]+$/.test(chosenCol) ? chosenCol : `"${chosenCol}"`) : null;

    const selectQ = `SELECT q.id, q.descricao, ${colExpr ? `q.${colExpr}` : 'false'} AS multipliaescolha,
      q.codigocategoria AS codigocategoria, q.codareaconhecimento AS codareaconhecimento, q.codgrupoprocesso AS codgrupoprocesso,
      eg."Descricao" AS explicacao
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
      multipliaescolha: !!(q.multipliaescolha || q.multipliaescolha === true),
      codigocategoria: q.codigocategoria || q.Codigocategoria || q.CodigoCategoria || null,
      codareaconhecimento: q.codareaconhecimento || q.Codareaconhecimento || q.CodAreaConhecimento || null,
      codgrupoprocesso: q.codgrupoprocesso || q.Codgrupoprocesso || q.CodGrupoProcesso || null,
      explicacao: q.explicacao || q.Explicacao,
      options: optsByQ[q.id] || []
    }));

    // generate temporary session id (not persisted yet)
  const sessionId = genSessionId();

    // Note: persistence to Simulation and simulation_questions is intentionally left commented for later activation.

    return res.json({ sessionId, total: payloadQuestions.length, questions: payloadQuestions });
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
// Body: { sessionId: string, answers: [{ questionId: number, optionId: number }] }
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
      const qid = Number(r.idquestao || r.IdQuestao);
      const oid = Number(r.id || r.Id);
      if (!Number.isNaN(qid) && !Number.isNaN(oid)) {
        if (!correctByQ[qid]) correctByQ[qid] = [];
        correctByQ[qid].push(oid);
      }
    });

    // grade: support single-choice and multi-choice answers (optionId or optionIds)
    let totalCorrect = 0;
    const details = answers.map(a => {
      const qid = Number(a.questionId);
      const correctSet = Array.isArray(correctByQ[qid]) ? Array.from(new Set(correctByQ[qid])) : [];
      // normalize chosen
      let chosenIds = [];
      if (Array.isArray(a.optionIds)) chosenIds = a.optionIds.map(x => Number(x)).filter(n => !Number.isNaN(n));
      else if (a.optionId !== undefined && a.optionId !== null) {
        const n = Number(a.optionId);
        if (!Number.isNaN(n)) chosenIds = [n];
      }
      // compare as sets (full credit only if exact match)
      const uniqChosen = Array.from(new Set(chosenIds));
      const ok = (uniqChosen.length === correctSet.length) && uniqChosen.every(v => correctSet.indexOf(v) >= 0);
      if (ok) totalCorrect += 1;
      return { questionId: qid, chosenOptionIds: uniqChosen, correctOptions: correctSet, correct: ok };
    });

    const result = { sessionId, totalQuestions: qids.length, totalCorrect, details };
    // Attempt to persist timing data into response_times if provided in payload.
    // Answers can optionally include: timeMs, activeMs, interruptions, firstResponseMs, startedAt, answeredAt
    try {
      if (Array.isArray(answers) && answers.length) {
        const inserts = [];
        for (const a of answers) {
          try {
            const qid = Number(a.questionId);
            if (Number.isNaN(qid)) continue;
            // detect timing fields presence
            const hasTiming = (a.timeMs !== undefined && a.timeMs !== null) || (a.activeMs !== undefined && a.activeMs !== null) || (a.firstResponseMs !== undefined && a.firstResponseMs !== null) || a.startedAt || a.answeredAt || (a.interruptions !== undefined && a.interruptions !== null);
            if (!hasTiming) continue;
            const startedAt = a.startedAt ? new Date(a.startedAt).toISOString() : new Date().toISOString();
            const answeredAt = a.answeredAt ? new Date(a.answeredAt).toISOString() : new Date().toISOString();
            const totalMs = a.timeMs !== undefined && a.timeMs !== null ? Number(a.timeMs) : 0;
            const activeMs = a.activeMs !== undefined && a.activeMs !== null ? Number(a.activeMs) : 0;
            const interruptions = a.interruptions !== undefined && a.interruptions !== null ? Number(a.interruptions) : 0;
            const firstResponseMs = a.firstResponseMs !== undefined && a.firstResponseMs !== null ? Number(a.firstResponseMs) : 0;
            const uid = user && (user.id || user.Id) ? Number(user.id || user.Id) : null;
            // queue an insert for this timing row
            inserts.push(sequelize.query(
              `INSERT INTO response_times (sessionid, userid, questionid, startedat, answeredat, totalms, activems, interruptions, firstresponsems)
               VALUES (:sessionId, :userId, :questionId, :startedAt, :answeredAt, :totalMs, :activeMs, :interruptions, :firstResponseMs)`,
              {
                replacements: {
                  sessionId: String(sessionId || ''),
                  userId: uid,
                  questionId: qid,
                  startedAt,
                  answeredAt,
                  totalMs: Number(totalMs),
                  activeMs: Number(activeMs),
                  interruptions: Number(interruptions),
                  firstResponseMs: Number(firstResponseMs)
                },
                type: sequelize.QueryTypes.INSERT
              }
            ));
          } catch (e) {
            console.warn('skipping timing insert for answer', a, e && e.message);
          }
        }
        if (inserts.length) {
          try {
            await Promise.all(inserts);
          } catch (e) {
            console.warn('failed to persist some response_times rows', e && e.message);
          }
        }
      }
    } catch (e) {
      console.warn('error while persisting response_times', e && e.message);
    }

    // Note: persistence to Simulation not implemented here (per request)
    return res.json(result);
  } catch (err) {
    console.error('Erro submitAnswers:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};