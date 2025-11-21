// IND8 - % Acertos/Erros por Area de Conhecimento
async function getAreaConhecimentoStats(req, res){
  try {
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : 'full';
    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return res.status(400).json({ message: 'Usuário não identificado' });

    // Identificar o último exame completo do usuário
    let idExame = parseInt(req.query.idExame, 10);
    if (!Number.isFinite(idExame) || idExame <= 0) {
      const lastExamSql = `SELECT a.id, a.exam_type_id
                           FROM exam_attempt a
                           WHERE a.user_id = :userId
                             AND a.exam_mode = :examMode
                             AND a.finished_at IS NOT NULL
                             ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
                           ORDER BY a.finished_at DESC
                           LIMIT 1`;
      const replacements = hasExamType ? { userId, examMode, examTypeId } : { userId, examMode };
      const lastExamRows = await sequelize.query(lastExamSql, { replacements, type: sequelize.QueryTypes.SELECT });
      if (!lastExamRows || !lastExamRows.length) {
        return res.json({ userId, examMode, examTypeId: hasExamType ? examTypeId : null, idExame: null, areas: [] });
      }
      idExame = Number(lastExamRows[0].id);
    }

    // Calcular acertos/erros por área de conhecimento
    const sql = `
      WITH pq AS (
        SELECT
          aq.id AS aqid,
          q.codareaconhecimento AS area_id,
          ac.descricao AS area_nome,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true) AS chosen_count,
          COUNT(DISTINCT ro_all."Id") FILTER (WHERE ro_all."IsCorreta" = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen."IsCorreta" = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN areaconhecimento ac ON ac.id = q.codareaconhecimento
        LEFT JOIN respostaopcao ro_all ON ro_all."IdQuestao" = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen."Id" = aa.option_id
        JOIN exam_attempt a ON a.id = aq.attempt_id
        WHERE aq.attempt_id = :idExame
          AND q.codareaconhecimento IS NOT NULL
          ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
        GROUP BY aq.id, q.codareaconhecimento, ac.descricao
      )
      SELECT
        area_id,
        area_nome,
        COUNT(*) FILTER (WHERE chosen_count = correct_count AND chosen_correct_count = correct_count)::int AS acertos,
        COUNT(*) FILTER (WHERE NOT (chosen_count = correct_count AND chosen_correct_count = correct_count))::int AS erros,
        COUNT(*)::int AS total
      FROM pq
      WHERE correct_count > 0
      GROUP BY area_id, area_nome
      ORDER BY area_nome;
    `;
    const replacements = hasExamType ? { idExame, examTypeId } : { idExame };
    const rows = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

    const areas = (rows || []).map(r => {
      const total = Number(r.total) || 1;
      const acertos = Number(r.acertos) || 0;
      const erros = Number(r.erros) || 0;
      const percentAcertos = Number(((acertos / total) * 100).toFixed(2));
      const percentErros = Number(((erros / total) * 100).toFixed(2));
      return {
        id: Number(r.area_id) || null,
        descricao: r.area_nome || String(r.area_id || 'Sem área'),
        acertos,
        erros,
        total,
        percentAcertos,
        percentErros
      };
    });

    return res.json({ userId, examMode, examTypeId: hasExamType ? examTypeId : null, idExame, areas });
  } catch(err){
    console.error('getAreaConhecimentoStats error:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
}

// IND9 - % Acertos/Erros por Abordagem (categoriaquestao)
async function getAbordagemStats(req, res){
  try {
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : 'full';
    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return res.status(400).json({ message: 'Usuário não identificado' });

    let idExame = parseInt(req.query.idExame, 10);
    if (!Number.isFinite(idExame) || idExame <= 0) {
      const lastExamSql = `SELECT a.id, a.exam_type_id
                           FROM exam_attempt a
                           WHERE a.user_id = :userId
                             AND a.exam_mode = :examMode
                             AND a.finished_at IS NOT NULL
                             ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
                           ORDER BY a.finished_at DESC
                           LIMIT 1`;
      const replacements = hasExamType ? { userId, examMode, examTypeId } : { userId, examMode };
      const lastExamRows = await sequelize.query(lastExamSql, { replacements, type: sequelize.QueryTypes.SELECT });
      if (!lastExamRows || !lastExamRows.length) {
        return res.json({ userId, examMode, examTypeId: hasExamType ? examTypeId : null, idExame: null, abordagens: [] });
      }
      idExame = Number(lastExamRows[0].id);
    }

    const sql = `
      WITH pq AS (
        SELECT
          aq.id AS aqid,
          q.codigocategoria AS abordagem_id,
          cq.descricao AS abordagem_nome,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true) AS chosen_count,
          COUNT(DISTINCT ro_all."Id") FILTER (WHERE ro_all."IsCorreta" = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen."IsCorreta" = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN categoriaquestao cq ON cq.id = q.codigocategoria
        LEFT JOIN respostaopcao ro_all ON ro_all."IdQuestao" = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen."Id" = aa.option_id
        JOIN exam_attempt a ON a.id = aq.attempt_id
        WHERE aq.attempt_id = :idExame
          AND q.codigocategoria IS NOT NULL
          ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
        GROUP BY aq.id, q.codigocategoria, cq.descricao
      )
      SELECT
        abordagem_id,
        abordagem_nome,
        COUNT(*) FILTER (WHERE chosen_count = correct_count AND chosen_correct_count = correct_count)::int AS acertos,
        COUNT(*) FILTER (WHERE NOT (chosen_count = correct_count AND chosen_correct_count = correct_count))::int AS erros,
        COUNT(*)::int AS total
      FROM pq
      WHERE correct_count > 0
      GROUP BY abordagem_id, abordagem_nome
      ORDER BY abordagem_id;
    `;
    const replacements = hasExamType ? { idExame, examTypeId } : { idExame };
    const rows = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

    const abordagens = (rows || []).map(r => {
      const total = Number(r.total) || 1;
      const acertos = Number(r.acertos) || 0;
      const erros = Number(r.erros) || 0;
      const percentAcertos = Number(((acertos / total) * 100).toFixed(2));
      const percentErros = Number(((erros / total) * 100).toFixed(2));
      return {
        id: Number(r.abordagem_id) || null,
        descricao: r.abordagem_nome || String(r.abordagem_id || 'Sem abordagem'),
        acertos,
        erros,
        total,
        percentAcertos,
        percentErros
      };
    });

    return res.json({ userId, examMode, examTypeId: hasExamType ? examTypeId : null, idExame, abordagens });
  } catch(err){
    console.error('getAbordagemStats error:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
}
const db = require('../models');
const sequelize = require('../config/database');

function getFullExamQuestionCount(){
  const n = Number(process.env.FULL_EXAM_QUESTION_COUNT || 180);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 180;
}

async function getOverview(req, res) {
  try {
    const out = {
      last15: {
        you: { total: 0, aprovado: 0, reprovado: 0 },
        others: { aprovado: 0, reprovado: 0 },
      },
      last30: {
        you: { total: 0, aprovado: 0, reprovado: 0 },
        others: { aprovado: 0, reprovado: 0 },
      },
      meta: { windowDays: { last15: 15, last30: 30 } },
    };
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ message: 'Erro interno' });
  }
}

async function getExamsCompleted(req, res) {
  try {
    const raw = parseInt(req.query.days, 10);
    const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 120) : 30;
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : null;
    const userId = Number.isFinite(parseInt(req.query.idUsuario, 10)) && parseInt(req.query.idUsuario, 10) > 0 ? parseInt(req.query.idUsuario, 10) : null;
    
    let sql, replacements;
    if (examMode) {
      sql = `SELECT COUNT(*)::int AS total
                 FROM exam_attempt
                 WHERE finished_at IS NOT NULL
                   AND exam_mode = :examMode
                   ${userId ? 'AND user_id = :userId' : ''}
                   AND finished_at >= NOW() - (:days || ' days')::interval`;
      replacements = { days: String(days), examMode, ...(userId ? { userId } : {}) };
    } else {
      sql = `SELECT COUNT(*)::int AS total
                 FROM exam_attempt
                 WHERE finished_at IS NOT NULL
                   AND (exam_mode = 'full' OR quantidade_questoes = :fullQ)
                   ${userId ? 'AND user_id = :userId' : ''}
                   AND finished_at >= NOW() - (:days || ' days')::interval`;
      replacements = { days: String(days), fullQ: getFullExamQuestionCount(), ...(userId ? { userId } : {}) };
    }
    
    const rows = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
    const total = rows && rows[0] ? Number(rows[0].total) : 0;
    return res.json({ days, examMode: examMode || 'full', userId: userId || null, total });
  } catch (err) {
    return res.status(500).json({ message: 'Erro interno' });
  }
}

async function getApprovalRate(req, res) {
  try {
    const raw = parseInt(req.query.days, 10);
    const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 120) : 30;
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : null;
    const userId = Number.isFinite(parseInt(req.query.idUsuario, 10)) && parseInt(req.query.idUsuario, 10) > 0 ? parseInt(req.query.idUsuario, 10) : null;
    
    let sql, replacements;
    if (examMode) {
      sql = `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE score_percent >= 75)::int AS approved
                 FROM exam_attempt
                 WHERE finished_at IS NOT NULL
                   AND exam_mode = :examMode
                   ${userId ? 'AND user_id = :userId' : ''}
                   AND finished_at >= NOW() - (:days || ' days')::interval`;
      replacements = { days: String(days), examMode, ...(userId ? { userId } : {}) };
    } else {
      sql = `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE score_percent >= 75)::int AS approved
                 FROM exam_attempt
                 WHERE finished_at IS NOT NULL
                   AND (exam_mode = 'full' OR quantidade_questoes = :fullQ)
                   ${userId ? 'AND user_id = :userId' : ''}
                   AND finished_at >= NOW() - (:days || ' days')::interval`;
      replacements = { days: String(days), fullQ: getFullExamQuestionCount(), ...(userId ? { userId } : {}) };
    }
    
    const rows = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
    const total = rows && rows[0] ? Number(rows[0].total) : 0;
    const approved = rows && rows[0] ? Number(rows[0].approved) : 0;
    const ratePercent = total > 0 ? Number(((approved * 100) / total).toFixed(2)) : null;
    return res.json({ days, examMode: examMode || 'full', userId: userId || null, total, approved, ratePercent });
  } catch (err) {
    return res.status(500).json({ message: 'Erro interno' });
  }
}

async function getFailureRate(req, res) {
  try {
    const raw = parseInt(req.query.days, 10);
    const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 120) : 30;
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : null;
    const userId = Number.isFinite(parseInt(req.query.idUsuario, 10)) && parseInt(req.query.idUsuario, 10) > 0 ? parseInt(req.query.idUsuario, 10) : null;
    
    let sql, replacements;
    if (examMode) {
      sql = `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE score_percent < 75)::int AS failed
                 FROM exam_attempt
                 WHERE finished_at IS NOT NULL
                   AND exam_mode = :examMode
                   ${userId ? 'AND user_id = :userId' : ''}
                   AND finished_at >= NOW() - (:days || ' days')::interval`;
      replacements = { days: String(days), examMode, ...(userId ? { userId } : {}) };
    } else {
      sql = `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE score_percent < 75)::int AS failed
                 FROM exam_attempt
                 WHERE finished_at IS NOT NULL
                   AND (exam_mode = 'full' OR quantidade_questoes = :fullQ)
                   ${userId ? 'AND user_id = :userId' : ''}
                   AND finished_at >= NOW() - (:days || ' days')::interval`;
      replacements = { days: String(days), fullQ: getFullExamQuestionCount(), ...(userId ? { userId } : {}) };
    }
    
    const rows = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
    const total = rows && rows[0] ? Number(rows[0].total) : 0;
    const failed = rows && rows[0] ? Number(rows[0].failed) : 0;
    const ratePercent = total > 0 ? Number(((failed * 100) / total).toFixed(2)) : null;
    return res.json({ days, examMode: examMode || 'full', userId: userId || null, total, failed, ratePercent });
  } catch (err) {
    return res.status(500).json({ message: 'Erro interno' });
  }
}

async function getOverviewDetailed(req, res) {
  try {
    const user = req.user || {};
    const userId = Number.isFinite(parseInt(user.sub, 10)) ? parseInt(user.sub, 10) : null;
    if (!userId) return res.status(400).json({ message: 'Usuário não identificado' });

    const rawDays = parseInt(req.query.days, 10);
    const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 120) : 30;
    const examMode = (req.query.exam_mode === 'quiz' || req.query.exam_mode === 'full') ? req.query.exam_mode : 'full';

    const sql = `SELECT 
        COUNT(*) FILTER (WHERE user_id = :userId)::int AS total_user,
        COUNT(*) FILTER (WHERE user_id = :userId AND score_percent >= 75)::int AS approved_user,
        COUNT(*) FILTER (WHERE user_id = :userId AND score_percent < 75)::int AS failed_user,
        COUNT(*) FILTER (WHERE user_id != :userId)::int AS total_others,
        COUNT(*) FILTER (WHERE user_id != :userId AND score_percent >= 75)::int AS approved_others,
        COUNT(*) FILTER (WHERE user_id != :userId AND score_percent < 75)::int AS failed_others
      FROM exam_attempt
      WHERE finished_at IS NOT NULL
        AND exam_mode = :examMode
        AND finished_at >= NOW() - (:days || ' days')::interval`;

    const rows = await sequelize.query(sql, {
      replacements: { userId, days: String(days), examMode },
      type: sequelize.QueryTypes.SELECT
    });

    const r = rows && rows[0] ? rows[0] : {};
    const totalUser = Number(r.total_user || 0);
    const approvedUser = Number(r.approved_user || 0);
    const failedUser = Number(r.failed_user || 0);
    const totalOthers = Number(r.total_others || 0);
    const approvedOthers = Number(r.approved_others || 0);
    const failedOthers = Number(r.failed_others || 0);

    const rateUser = totalUser > 0 ? Number(((approvedUser * 100) / totalUser).toFixed(2)) : null;
    const rateFailedUser = totalUser > 0 ? Number(((failedUser * 100) / totalUser).toFixed(2)) : null;
    const rateApprovedOthers = totalOthers > 0 ? Number(((approvedOthers * 100) / totalOthers).toFixed(2)) : null;
    const rateFailedOthers = totalOthers > 0 ? Number(((failedOthers * 100) / totalOthers).toFixed(2)) : null;

    // Map directly to requested cells
    return res.json({
      params: { days, examMode, userId },
      cells: {
        'OV-R4C2': totalUser,          // Indicador 1 (total exames do usuário)
        'OV-R4C3': rateUser,           // Indicador 2 (aprovação %) do usuário
        'OV-R4C4': rateFailedUser,     // Indicador 3 (reprovação %) do usuário
        'OV-R4C5': rateApprovedOthers, // Indicador 2 (aprovação %) de outros
        'OV-R4C6': rateFailedOthers    // Indicador 3 (reprovação %) de outros
      },
      aggregates: {
        totalUser, approvedUser, failedUser, rateUser, rateFailedUser,
        totalOthers, approvedOthers, failedOthers, rateApprovedOthers, rateFailedOthers
      }
    });
  } catch (err) {
    return res.status(500).json({ message: 'Erro interno' });
  }
}

async function getQuestionsCount(req, res){
  try {
    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;
    const sql = `SELECT COUNT(*)::int AS total
                 FROM questao
                 WHERE excluido = false AND idstatus = 1
                   ${hasExamType ? 'AND exam_type_id = :examTypeId' : ''}`;
    const rows = await sequelize.query(sql, { replacements: hasExamType ? { examTypeId } : {}, type: sequelize.QueryTypes.SELECT });
    const total = rows && rows[0] ? Number(rows[0].total) : 0;
    return res.json({ examTypeId: hasExamType ? examTypeId : null, total });
  } catch(err){
    return res.status(500).json({ message: 'Erro interno' });
  }
}

async function getAnsweredQuestionsCount(req, res){
  try {
    const examTypeId = parseInt(req.query.exam_type, 10);
    if (!Number.isFinite(examTypeId) || examTypeId <= 0) {
      return res.status(400).json({ message: 'exam_type obrigatório' });
    }
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return res.status(400).json({ message: 'Usuário não identificado' });

    const sql = `SELECT COUNT(DISTINCT aq.question_id)::int AS respondidas
                 FROM exam_attempt a
                 JOIN exam_attempt_question aq ON aq.attempt_id = a.id
                 JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
                 WHERE a.user_id = :userId
                   AND a.exam_type_id = :examTypeId`;
    const rows = await sequelize.query(sql, { replacements: { userId, examTypeId }, type: sequelize.QueryTypes.SELECT });
    const total = rows && rows[0] ? Number(rows[0].respondidas) : 0;
    return res.json({ examTypeId, userId, total });
  } catch(err){
    return res.status(500).json({ message: 'Erro interno' });
  }
}

async function getTotalHours(req, res){
  try {
    const examTypeId = parseInt(req.query.exam_type, 10);
    if (!Number.isFinite(examTypeId) || examTypeId <= 0) {
      return res.status(400).json({ message: 'exam_type obrigatório' });
    }
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return res.status(400).json({ message: 'Usuário não identificado' });

    const sql = `SELECT COALESCE(SUM(COALESCE(aq.tempo_gasto_segundos,0)),0)::bigint AS segundos
                 FROM exam_attempt a
                 JOIN exam_attempt_question aq ON aq.attempt_id = a.id
                 WHERE a.user_id = :userId
                   AND a.exam_type_id = :examTypeId
                   AND (a.status = 'finished' OR a.status IS NULL)`;
    const rows = await sequelize.query(sql, { replacements: { userId, examTypeId }, type: sequelize.QueryTypes.SELECT });
    const segundos = rows && rows[0] ? Number(rows[0].segundos) : 0;
    const horas = Number((segundos / 3600).toFixed(2));
    return res.json({ examTypeId, userId, segundos, horas });
  } catch(err){
    return res.status(500).json({ message: 'Erro interno' });
  }
}

async function getProcessGroupStats(req, res){
  try {
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : 'full';
    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return res.status(400).json({ message: 'Usuário não identificado' });

    // Identificar o último exame do usuário (considerando exam_type se fornecido)
    let idExame = parseInt(req.query.idExame, 10);
    if (!Number.isFinite(idExame) || idExame <= 0) {
      const lastExamSql = `SELECT a.id, a.exam_type_id
                           FROM exam_attempt a
                           WHERE a.user_id = :userId
                             AND a.exam_mode = :examMode
                             AND a.finished_at IS NOT NULL
                             ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
                           ORDER BY a.finished_at DESC
                           LIMIT 1`;
      const replacements = hasExamType ? { userId, examMode, examTypeId } : { userId, examMode };
      const lastExamRows = await sequelize.query(lastExamSql, { replacements, type: sequelize.QueryTypes.SELECT });
      if (!lastExamRows || !lastExamRows.length) {
        return res.json({ userId, examMode, examTypeId: hasExamType ? examTypeId : null, idExame: null, grupos: [] });
      }
      idExame = Number(lastExamRows[0].id);
    }

    // Calcular acertos/erros por grupo de processos nesse exame (por questão)
    // Regra: uma questão é considerada correta quando o conjunto de opções escolhidas
    // é exatamente igual ao conjunto de opções corretas cadastradas em respostaopcao.
    const sql = `
      WITH pq AS (
        SELECT
          aq.id AS aqid,
          q.codgrupoprocesso AS grupo,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true) AS chosen_count,
          COUNT(DISTINCT ro_all."Id") FILTER (WHERE ro_all."IsCorreta" = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen."IsCorreta" = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN respostaopcao ro_all ON ro_all."IdQuestao" = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen."Id" = aa.option_id
        JOIN exam_attempt a ON a.id = aq.attempt_id
        WHERE aq.attempt_id = :idExame
          AND q.codgrupoprocesso IS NOT NULL
          AND q.codgrupoprocesso > 0
          ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
        GROUP BY aq.id, q.codgrupoprocesso
      )
      SELECT
        grupo AS grupo,
        COUNT(*) FILTER (WHERE chosen_count = correct_count AND chosen_correct_count = correct_count)::int AS acertos,
        COUNT(*) FILTER (WHERE NOT (chosen_count = correct_count AND chosen_correct_count = correct_count))::int AS erros,
        COUNT(*)::int AS total
      FROM pq
      WHERE correct_count > 0
      GROUP BY grupo
      ORDER BY grupo;
    `;
    const replacements = hasExamType ? { idExame, examTypeId } : { idExame };
    const rows = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

    // Mapear código do grupo -> descrição a partir da tabela de referência
    let groupMap = {};
    try {
      const candidates = ['grupoprocesso', 'gruprocesso'];
      let chosen = null;
      let idCol = null;
      let descCol = null;
      let whereSoft = '';
      for (const tbl of candidates) {
        const cols = await sequelize.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :tbl`,
          { replacements: { tbl }, type: sequelize.QueryTypes.SELECT }
        );
        if (!cols || !cols.length) continue;
        const names = new Set(cols.map(c => c.column_name));
        const idc = names.has('id') ? 'id' : (names.has('Id') ? '"Id"' : null);
        const dsc = names.has('descricao') ? 'descricao' : (names.has('Descricao') ? '"Descricao"' : null);
        if (!idc || !dsc) continue;
        chosen = tbl; idCol = idc; descCol = dsc;
        if (names.has('excluido')) whereSoft = 'WHERE (excluido = false OR excluido IS NULL)';
        else if (names.has('Excluido')) whereSoft = 'WHERE ("Excluido" = false OR "Excluido" IS NULL)';
        break;
      }
      if (chosen) {
        const mapRows = await sequelize.query(
          `SELECT ${idCol} AS id, ${descCol} AS descricao FROM ${chosen} ${whereSoft}`,
          { type: sequelize.QueryTypes.SELECT }
        );
        groupMap = (mapRows || []).reduce((acc, r) => {
          const k = Number(r.id);
          if (Number.isFinite(k)) acc[k] = r.descricao;
          return acc;
        }, {});
      }
    } catch(_) { /* ignore */ }

    const grupos = (rows || []).map(r => {
      const total = Number(r.total) || 1; // evitar divisão por zero
      const acertos = Number(r.acertos) || 0;
      const erros = Number(r.erros) || 0;
      const percentAcertos = Number(((acertos / total) * 100).toFixed(2));
      const percentErros = Number(((erros / total) * 100).toFixed(2));
      return {
        grupo: Number(r.grupo) || null,
        descricao: (groupMap && groupMap[Number(r.grupo)]) ? groupMap[Number(r.grupo)] : String(r.grupo || 'Sem grupo'),
        acertos,
        erros,
        total,
        percentAcertos,
        percentErros
      };
    });

    return res.json({ userId, examMode, examTypeId: hasExamType ? examTypeId : null, idExame, grupos });
  } catch(err){
    console.error('getProcessGroupStats error:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
}

// DET-LAST: Detalhes por grupo (última tentativa concluída)
// Regras:
// - Considera a última tentativa concluída do usuário (exam_mode filtro; exam_type opcional)
// - Uma questão é correta quando o conjunto de opções escolhidas == conjunto de opções corretas (respostaopcao.IsCorreta)
// - Não respondidas contam como incorretas
// - Percentual = (#corretas / total questões do grupo no exame) * 100
// - Ranking: #Corretas desc, Percentual desc, Id do grupo asc (empatados recebem mesma posição - dense rank)
async function getDetailsLast(req, res){
  try {
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : 'full';
    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return res.status(400).json({ message: 'Usuário não identificado' });

    // Descobrir última tentativa concluída
    const lastExamSql = `SELECT a.id, a.exam_type_id
                         FROM exam_attempt a
                         WHERE a.user_id = :userId
                           AND a.exam_mode = :examMode
                           AND a.finished_at IS NOT NULL
                           ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
                         ORDER BY a.finished_at DESC
                         LIMIT 1`;
    const lastExamRows = await sequelize.query(lastExamSql, { replacements: hasExamType ? { userId, examMode, examTypeId } : { userId, examMode }, type: sequelize.QueryTypes.SELECT });
    if (!lastExamRows || !lastExamRows.length) {
      return res.json({ userId, examMode, examTypeId: hasExamType ? examTypeId : null, idExame: null, itens: [] });
    }
    const idExame = Number(lastExamRows[0].id);

    // Agregar por grupo: corretas/total baseado em respostaopcao
    const sql = `
      WITH pq AS (
        SELECT
          aq.id AS aqid,
          q.codgrupoprocesso AS grupo,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true) AS chosen_count,
          COUNT(DISTINCT ro_all."Id") FILTER (WHERE ro_all."IsCorreta" = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen."IsCorreta" = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN respostaopcao ro_all ON ro_all."IdQuestao" = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen."Id" = aa.option_id
        JOIN exam_attempt a ON a.id = aq.attempt_id
        WHERE aq.attempt_id = :idExame
          AND q.codgrupoprocesso IS NOT NULL
          AND q.codgrupoprocesso > 0
          ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
        GROUP BY aq.id, q.codgrupoprocesso
      )
      SELECT
        grupo AS grupo,
        COUNT(*) FILTER (WHERE chosen_count = correct_count AND chosen_correct_count = correct_count)::int AS corretas,
        COUNT(*)::int AS total
      FROM pq
      GROUP BY grupo
      ORDER BY grupo`;
    const aggRows = await sequelize.query(sql, { replacements: hasExamType ? { idExame, examTypeId } : { idExame }, type: sequelize.QueryTypes.SELECT });

    // Mapear grupos de referência para incluir grupos sem questões
    let groupMap = {};
    try {
      const candidates = ['grupoprocesso', 'gruprocesso'];
      let chosen = null; let idCol = null; let descCol = null; let whereSoft = '';
      for (const tbl of candidates) {
        const cols = await sequelize.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :tbl`,
          { replacements: { tbl }, type: sequelize.QueryTypes.SELECT }
        );
        if (!cols || !cols.length) continue;
        const names = new Set(cols.map(c => c.column_name));
        const idc = names.has('id') ? 'id' : (names.has('Id') ? '"Id"' : null);
        const dsc = names.has('descricao') ? 'descricao' : (names.has('Descricao') ? '"Descricao"' : null);
        if (!idc || !dsc) continue;
        chosen = tbl; idCol = idc; descCol = dsc;
        if (names.has('excluido')) whereSoft = 'WHERE (excluido = false OR excluido IS NULL)';
        else if (names.has('Excluido')) whereSoft = 'WHERE ("Excluido" = false OR "Excluido" IS NULL)';
        break;
      }
      if (chosen) {
        const mapRows = await sequelize.query(
          `SELECT ${idCol} AS id, ${descCol} AS descricao FROM ${chosen} ${whereSoft}`,
          { type: sequelize.QueryTypes.SELECT }
        );
        groupMap = (mapRows || []).reduce((acc, r) => {
          const k = Number(r.id);
          if (Number.isFinite(k)) acc[k] = r.descricao;
          return acc;
        }, {});
      }
    } catch(_) { /* ignore */ }

    // Merge agregados com grupos de referência para garantir cobertura total
    const byGroup = new Map((aggRows || []).map(r => [Number(r.grupo), { corretas: Number(r.corretas)||0, total: Number(r.total)||0 }]));
    const items = Object.keys(groupMap).map(k => Number(k)).sort((a,b) => a-b).map(id => {
      const rec = byGroup.get(id) || { corretas: 0, total: 0 };
      const pct = rec.total > 0 ? Number(((rec.corretas * 100) / rec.total).toFixed(2)) : null;
      return { id, descricao: groupMap[id] || String(id), corretas: rec.corretas, total: rec.total, percentCorretas: pct };
    });

    // Ranking: %Corretas desc (NULLS LAST), #Corretas desc, descricao asc (dense)
    const sorted = items.slice().sort((a,b) => {
      const ap = a.percentCorretas; const bp = b.percentCorretas;
      // Percentual primeiro (desc), tratando null como menor
      if (bp == null && ap != null) return -1; // a vem antes (maior pct)
      if (ap == null && bp != null) return 1;  // b vem antes
      if (ap != null && bp != null && bp !== ap) return bp - ap; // desc
      // Depois número de corretas (desc)
      if (b.corretas !== a.corretas) return b.corretas - a.corretas;
      // Desempate final por descrição (asc, caso-insensitive)
      return String(a.descricao).localeCompare(String(b.descricao), 'pt-BR');
    });
    // Dense rank considerando que a descrição quebra empate, logo cada combinação distinta de (pct, corretas, descricao)
    const rankMap = new Map();
    let last = null; let rank = 0;
    for (const it of sorted) {
      const sig = JSON.stringify([
        it.percentCorretas == null ? null : Number(it.percentCorretas),
        it.corretas,
        String(it.descricao).toLowerCase()
      ]);
      if (sig !== last) { rank += 1; last = sig; }
      rankMap.set(it.id, rank);
    }
    const itens = items.map(it => ({ ...it, ranking: rankMap.get(it.id) || null }));

    return res.json({ userId, examMode, examTypeId: hasExamType ? examTypeId : null, idExame, itens });
  } catch(err) {
    console.error('getDetailsLast error:', err);
    return res.status(500).json({ message: 'Erro interno' });
  }
}

module.exports = { getOverview, getExamsCompleted, getApprovalRate, getFailureRate, getOverviewDetailed, getQuestionsCount, getAnsweredQuestionsCount, getTotalHours, getProcessGroupStats, getAreaConhecimentoStats, getAbordagemStats, getDetailsLast };
