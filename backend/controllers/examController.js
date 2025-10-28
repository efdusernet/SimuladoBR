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

    // Optional domain filter
    const dominios = Array.isArray(req.body.dominios) && req.body.dominios.length ? req.body.dominios.map(Number) : null;

    // Build WHERE clause
    const whereClauses = [`excluido = false`, `idstatus = 1`];
    if (bloqueio) whereClauses.push(`seed = true`);
    if (dominios) whereClauses.push(`iddominio IN (${dominios.map(d => Number(d)).join(',')})`);
    const whereSql = whereClauses.join(' AND ');

    // Count available
  const countQuery = `SELECT COUNT(*)::int AS cnt FROM questao WHERE ${whereSql}`;
    const countRes = await sequelize.query(countQuery, { type: sequelize.QueryTypes.SELECT });
    const available = (countRes && countRes[0] && Number(countRes[0].cnt)) || 0;
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
      if (r && (r.id || r.Id) && (r.idquestao || r.IdQuestao)) {
        correctByQ[Number(r.idquestao || r.IdQuestao)] = Number(r.id || r.Id);
      }
    });

    // grade
    let totalCorrect = 0;
    const details = answers.map(a => {
      const qid = Number(a.questionId);
      const chosen = Number(a.optionId);
      const correctOpt = correctByQ[qid] || null;
      const ok = !!(correctOpt && chosen === correctOpt);
      if (ok) totalCorrect += 1;
      return { questionId: qid, chosenOptionId: chosen, correct: ok };
    });

    const result = { sessionId, totalQuestions: qids.length, totalCorrect, details };

    // Note: persistence to Simulation not implemented here (per request)
    return res.json(result);
  } catch (err) {
    console.error('Erro submitAnswers:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};