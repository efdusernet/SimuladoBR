const { badRequest, internalError } = require('../middleware/errors');

// IND8 - % Acertos/Erros por Area de Conhecimento
async function getAreaConhecimentoStats(req, res, next){
  try {
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : 'full';
    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

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
    // Observação: algumas bases podem não ter a tabela de referência `areaconhecimento`.
    // Então tentamos com JOIN (para pegar descrição) e, se falhar, refazemos sem JOIN.
    const sqlWithJoin = `
      WITH pq AS (
        SELECT
          aq.id AS aqid,
          q.codareaconhecimento AS area_id,
          ac.descricao AS area_nome,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true) AS chosen_count,
          COUNT(DISTINCT ro_all.id) FILTER (WHERE ro_all.iscorreta = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen.iscorreta = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN areaconhecimento ac ON ac.id = q.codareaconhecimento
        LEFT JOIN respostaopcao ro_all ON ro_all.idquestao = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen.id = aa.option_id
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

    const sqlNoJoin = `
      WITH pq AS (
        SELECT
          aq.id AS aqid,
          q.codareaconhecimento AS area_id,
          NULL::text AS area_nome,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true) AS chosen_count,
          COUNT(DISTINCT ro_all.id) FILTER (WHERE ro_all.iscorreta = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen.iscorreta = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN respostaopcao ro_all ON ro_all.idquestao = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen.id = aa.option_id
        JOIN exam_attempt a ON a.id = aq.attempt_id
        WHERE aq.attempt_id = :idExame
          AND q.codareaconhecimento IS NOT NULL
          ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
        GROUP BY aq.id, q.codareaconhecimento
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
      ORDER BY area_id;
    `;

    const replacements = hasExamType ? { idExame, examTypeId } : { idExame };
    let rows;
    try {
      rows = await sequelize.query(sqlWithJoin, { replacements, type: sequelize.QueryTypes.SELECT });
    } catch (errJoin) {
      rows = await sequelize.query(sqlNoJoin, { replacements, type: sequelize.QueryTypes.SELECT });
    }

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
    const publicMsg = process.env.NODE_ENV === 'development'
      ? `Erro interno: ${err && err.message ? String(err.message) : 'desconhecido'}`
      : 'Erro interno';
    return next(internalError(publicMsg, 'AREA_CONHECIMENTO_STATS_ERROR', err));
  }
}

// IND9 - % Acertos/Erros por Abordagem (categoriaquestao)
async function getAbordagemStats(req, res, next){
  try {
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : 'full';
    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

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
          COUNT(DISTINCT ro_all.id) FILTER (WHERE ro_all.iscorreta = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen.iscorreta = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN categoriaquestao cq ON cq.id = q.codigocategoria
        LEFT JOIN respostaopcao ro_all ON ro_all.idquestao = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen.id = aa.option_id
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
    return next(internalError('Erro interno', 'ABORDAGEM_STATS_ERROR', err));
  }
}
const db = require('../models');
const { logger } = require('../utils/logger');
const sequelize = require('../config/database');

function getFullExamQuestionCount(){
  const n = Number(process.env.FULL_EXAM_QUESTION_COUNT || 180);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 180;
}

async function getOverview(req, res, next) {
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
    return next(internalError('Erro interno', 'OVERVIEW_ERROR', err));
  }
}

async function getExamsCompleted(req, res, next) {
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
    return next(internalError('Erro interno', 'EXAMS_COMPLETED_ERROR', err));
  }
}

async function getApprovalRate(req, res, next) {
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
    return next(internalError('Erro interno', 'APPROVAL_RATE_ERROR', err));
  }
}

async function getFailureRate(req, res, next) {
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
    return next(internalError('Erro interno', 'FAILURE_RATE_ERROR', err));
  }
}

async function getOverviewDetailed(req, res, next) {
  try {
    const user = req.user || {};
    const userId = Number.isFinite(parseInt(user.sub, 10)) ? parseInt(user.sub, 10) : null;
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

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
    return next(internalError('Erro interno', 'OVERVIEW_DETAILED_ERROR', err));
  }
}

async function getQuestionsCount(req, res, next){
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
    return next(internalError('Erro interno', 'QUESTIONS_COUNT_ERROR', err));
  }
}

async function getAnsweredQuestionsCount(req, res, next){
  try {
    const examTypeId = parseInt(req.query.exam_type, 10);
    if (!Number.isFinite(examTypeId) || examTypeId <= 0) {
      return next(badRequest('exam_type obrigatório', 'EXAM_TYPE_REQUIRED'));
    }
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

    const sql = `
      SELECT 
        COUNT(DISTINCT aq.question_id)::int AS historico_distinto,
        COUNT(DISTINCT CASE WHEN q.excluido = false AND q.idstatus = 1 THEN aq.question_id END)::int AS ativos_distintos
      FROM exam_attempt a
      JOIN exam_attempt_question aq ON aq.attempt_id = a.id
      JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
      LEFT JOIN questao q ON q.id = aq.question_id
      WHERE a.user_id = :userId
        AND a.exam_type_id = :examTypeId`;
    const rows = await sequelize.query(sql, { replacements: { userId, examTypeId }, type: sequelize.QueryTypes.SELECT });
    const historico = rows && rows[0] ? Number(rows[0].historico_distinto) : 0;
    const ativos = rows && rows[0] ? Number(rows[0].ativos_distintos) : 0;
    return res.json({ examTypeId, userId, historicalDistinct: historico, activeDistinct: ativos });
  } catch(err){
    return next(internalError('Erro interno', 'ANSWERED_QUESTIONS_COUNT_ERROR', err));
  }
}

async function getTotalHours(req, res, next){
  try {
    const examTypeId = parseInt(req.query.exam_type, 10);
    if (!Number.isFinite(examTypeId) || examTypeId <= 0) {
      return next(badRequest('exam_type obrigatório', 'EXAM_TYPE_REQUIRED'));
    }
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

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
    return next(internalError('Erro interno', 'TOTAL_HOURS_ERROR', err));
  }
}

async function getProcessGroupStats(req, res, next){
  try {
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : 'full';
    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

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
          COUNT(DISTINCT ro_all.id) FILTER (WHERE ro_all.iscorreta = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen.iscorreta = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN respostaopcao ro_all ON ro_all.idquestao = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen.id = aa.option_id
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
    return next(internalError('Erro interno', 'PROCESS_GROUP_STATS_ERROR', err));
  }
}

// DET-LAST: Detalhes por grupo (última tentativa concluída)
// Regras:
// - Considera a última tentativa concluída do usuário (exam_mode filtro; exam_type opcional)
// - Uma questão é correta quando o conjunto de opções escolhidas == conjunto de opções corretas (respostaopcao.IsCorreta)
// - Não respondidas contam como incorretas
// - Percentual = (#corretas / total questões do grupo no exame) * 100
// - Ranking: #Corretas desc, Percentual desc, Id do grupo asc (empatados recebem mesma posição - dense rank)
async function getDetailsLast(req, res, next){
  try {
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : 'full';
    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

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
    logger.info('[DET-LAST] lastExamRows', lastExamRows);
    if (!lastExamRows || !lastExamRows.length) {
      return res.json({ userId, examMode, examTypeId: hasExamType ? examTypeId : null, idExame: null, itens: [] });
    }
    const idExame = Number(lastExamRows[0].id);
    logger.info('[DET-LAST] idExame', idExame);

    // Agregar por grupo: corretas/total baseado em respostaopcao
    const sql = `
      WITH pq AS (
        SELECT
          aq.id AS aqid,
          q.codgrupoprocesso AS grupo,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true) AS chosen_count,
          COUNT(DISTINCT ro_all.id) FILTER (WHERE ro_all.iscorreta = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen.iscorreta = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN respostaopcao ro_all ON ro_all.idquestao = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen.id = aa.option_id
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
    logger.info('[DET-LAST] aggRows', aggRows);

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
    return next(internalError('Erro interno', 'DETAILS_LAST_ERROR', err));
  }
}

// IND10 - Performance por Domínio
async function getPerformancePorDominio(req, res, next){
  try {
    // Modo de seleção do exame: 'best' ou 'last'. Aceita examMode ou exam_mode para flexibilidade.
    const examMode = req.query.examMode || req.query.exam_mode || 'last';
    const rawMax = parseInt(req.query.max_exams, 10);
    const maxExams = Number.isFinite(rawMax) ? Math.min(Math.max(rawMax, 1), 200) : null;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    // Fallback em ordem: idUsuario query, req.user.sub (padronizado nos outros controles), req.user.id.
    const userId = Number.isFinite(userIdParam) && userIdParam > 0
      ? userIdParam
      : (req.user && Number.isFinite(parseInt(req.user?.sub, 10))
          ? parseInt(req.user.sub, 10)
          : (req.user && Number.isFinite(parseInt(req.user?.id, 10))
              ? parseInt(req.user.id, 10)
              : null));
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

    // SQL para buscar exames finalizados do usuário
    const examsSql = `
      SELECT 
        a.id, 
        a.finished_at,
        a.exam_mode
      FROM exam_attempt a
      WHERE a.user_id = :userId
        AND a.finished_at IS NOT NULL
        AND a.exam_mode = 'full'
      ORDER BY a.finished_at DESC
      ${maxExams ? 'LIMIT :maxExams' : ''}
    `;
    
    const exams = await sequelize.query(examsSql, { 
      replacements: { userId, ...(maxExams ? { maxExams } : {}) }, 
      type: sequelize.QueryTypes.SELECT 
    });

    if (!exams || exams.length === 0) {
      return res.json({ 
        userId, 
        examMode, 
        examAttemptId: null, 
        examDate: null, 
        domains: [] 
      });
    }

    let selectedExam = null;

    if (examMode === 'last') {
      // Último exame completo finalizado
      selectedExam = exams[0];
    } else if (examMode === 'best') {
      // Determinar melhor exame via agregação única (evita N consultas).
      const examIds = exams.map(e => e.id);
      if (!examIds.length) {
        selectedExam = exams[0];
      } else {
        const bestSql = `
          WITH ques AS (
            SELECT
              aq.id,
              aq.attempt_id,
              COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada) AS chosen_count,
              COUNT(DISTINCT ro_all.id) FILTER (WHERE ro_all.iscorreta) AS correct_count,
              COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada AND ro_chosen.iscorreta) AS chosen_correct_count
            FROM exam_attempt_question aq
            LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
            LEFT JOIN respostaopcao ro_all ON ro_all.idquestao = aq.question_id
            LEFT JOIN respostaopcao ro_chosen ON ro_chosen.id = aa.option_id
            WHERE aq.attempt_id IN (:examIds)
            GROUP BY aq.id, aq.attempt_id
          ),
          perf AS (
            SELECT
              attempt_id,
              COUNT(*) FILTER (WHERE chosen_count = correct_count AND chosen_correct_count = correct_count) AS corretas,
              COUNT(*) AS total
            FROM ques
            WHERE correct_count > 0
            GROUP BY attempt_id
          )
          SELECT attempt_id,
                 corretas,
                 total,
                 CASE WHEN total > 0 THEN (corretas::float / total) * 100 ELSE 0 END AS score
          FROM perf
          ORDER BY score DESC, attempt_id DESC
          LIMIT 1
        `;
        try {
          const perfRows = await sequelize.query(bestSql, {
            replacements: { examIds },
            type: sequelize.QueryTypes.SELECT
          });
            const top = perfRows && perfRows[0];
            if (top) {
              selectedExam = exams.find(e => e.id === top.attempt_id) || exams[0];
            } else {
              selectedExam = exams[0];
            }
        } catch(e) {
          logger.error('Falha ao calcular melhor exame (agregado):', e.message);
          selectedExam = exams[0];
        }
      }
    } else {
      return next(badRequest('examMode inválido. Use "best" ou "last".', 'INVALID_EXAM_MODE'));
    }

    if (!selectedExam) {
      return res.json({ 
        userId, 
        examMode, 
        examAttemptId: null, 
        examDate: null, 
        domains: [] 
      });
    }

    // Calcular performance por domínio para o exame selecionado
    // Usa mesma lógica dos outros indicadores: questão correta quando conjunto de opções escolhidas == conjunto de opções corretas
    const domainSql = `
      WITH pq AS (
        SELECT
          aq.id AS aqid,
          q.iddominiogeral AS domain_id,
          dg.descricao AS domain_name,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true) AS chosen_count,
          COUNT(DISTINCT ro_all.id) FILTER (WHERE ro_all.iscorreta = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen.iscorreta = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        JOIN dominiogeral dg ON dg.id = q.iddominiogeral
        LEFT JOIN respostaopcao ro_all ON ro_all.idquestao = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen.id = aa.option_id
        WHERE aq.attempt_id = :examId
          AND q.iddominiogeral IS NOT NULL
        GROUP BY aq.id, q.iddominiogeral, dg.descricao
      )
      SELECT
        domain_id,
        domain_name,
        COUNT(*) FILTER (WHERE chosen_count = correct_count AND chosen_correct_count = correct_count)::int AS corretas,
        COUNT(*)::int AS total
      FROM pq
      WHERE correct_count > 0
      GROUP BY domain_id, domain_name
      ORDER BY domain_id
    `;

    const domainStats = await sequelize.query(domainSql, {
      replacements: { examId: selectedExam.id },
      type: sequelize.QueryTypes.SELECT
    });

    const domains = domainStats.map(d => ({
      id: d.domain_id,
      name: d.domain_name,
      corretas: parseInt(d.corretas, 10) || 0,
      total: parseInt(d.total, 10) || 0,
      percentage: d.total > 0 ? parseFloat(((d.corretas / d.total) * 100).toFixed(2)) : 0
    }));

    return res.json({
      userId,
      examMode,
      examAttemptId: selectedExam.id,
      examDate: selectedExam.finished_at,
      domains
    });

  } catch(err) {
    return next(internalError('Erro interno', 'PERFORMANCE_POR_DOMINIO_ERROR', err));
  }
}

// IND11 - Tempo médio de resposta por questão
async function getAvgTimePerQuestion(req, res, next){
  try {
    const examMode = req.query.exam_mode && ['quiz', 'full'].includes(req.query.exam_mode) ? req.query.exam_mode : 'full';
    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0 ? userIdParam : (req.user && Number.isFinite(parseInt(req.user.sub,10)) ? parseInt(req.user.sub,10) : null);
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

    const raw = parseInt(req.query.days, 10);
    const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 120) : 30;

    // Calcular tempo médio, total de questões e tempo total (filtrar outliers: entre 5seg e 600seg = 10min)
    const sql = `
      SELECT 
        AVG(aq.tempo_gasto_segundos)::numeric(10,2) AS avg_seconds,
        COUNT(*)::int AS total_questions,
        SUM(aq.tempo_gasto_segundos)::bigint AS total_seconds
      FROM exam_attempt a
      JOIN exam_attempt_question aq ON aq.attempt_id = a.id
      WHERE a.user_id = :userId
        AND a.exam_mode = :examMode
        AND a.finished_at IS NOT NULL
        AND a.finished_at >= NOW() - (:days || ' days')::interval
        AND aq.tempo_gasto_segundos IS NOT NULL
        AND aq.tempo_gasto_segundos > 5
        AND aq.tempo_gasto_segundos <= 600
        ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
    `;
    const replacements = { userId, examMode, days: String(days), ...(hasExamType ? { examTypeId } : {}) };
    const rows = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

    const avgSeconds = rows && rows[0] && rows[0].avg_seconds ? Number(rows[0].avg_seconds) : 0;
    const totalQuestions = rows && rows[0] ? Number(rows[0].total_questions) : 0;
    const totalSeconds = rows && rows[0] ? Number(rows[0].total_seconds) : 0;
    const avgMinutes = avgSeconds > 0 ? Number((avgSeconds / 60).toFixed(2)) : 0;
    const totalTimeHours = totalSeconds > 0 ? Number((totalSeconds / 3600).toFixed(2)) : 0;

    return res.json({ 
      userId, 
      examMode, 
      examTypeId: hasExamType ? examTypeId : null,
      days,
      avgSeconds: Number(avgSeconds.toFixed(1)),
      avgMinutes,
      totalQuestions,
      totalSeconds,
      totalTimeHours
    });
  } catch(err){
    return next(internalError('Erro interno', 'AVG_TIME_PER_QUESTION_ERROR', err));
  }
}

// IND12 - Média ponderada por Domínio (agregado em todos os exames completos do usuário)
async function getPerformancePorDominioAgregado(req, res, next) {
  try {
    const user = req.user || {};
    // Resolve userId from middleware (`req.user.id`) or JWT-like `sub`, or `idUsuario` query fallback
    let userId = null;
    if (Number.isFinite(parseInt(user.id, 10))) userId = parseInt(user.id, 10);
    else if (Number.isFinite(parseInt(user.sub, 10))) userId = parseInt(user.sub, 10);
    else if (Number.isFinite(parseInt(req.query.idUsuario, 10))) userId = parseInt(req.query.idUsuario, 10);
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;

    const sql = `
      WITH attempts AS (
        SELECT a.id
        FROM exam_attempt a
        WHERE a.user_id = :userId
          AND a.finished_at IS NOT NULL
          AND (a.exam_mode = 'full' OR a.quantidade_questoes = :fullQ)
          ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
      ),
      per_question AS (
        SELECT
          aq.id AS aqid,
          q.iddominiogeral AS dominio_id,
          dg.descricao AS dominio_nome,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true) AS chosen_count,
          COUNT(DISTINCT ro_all.id) FILTER (WHERE ro_all.iscorreta = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen.iscorreta = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        JOIN attempts a ON a.id = aq.attempt_id
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN dominiogeral dg ON dg.id = q.iddominiogeral
        LEFT JOIN respostaopcao ro_all ON ro_all.idquestao = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen.id = aa.option_id
        WHERE q.iddominiogeral IS NOT NULL
        GROUP BY aq.id, q.iddominiogeral, dg.descricao
      )
      SELECT
        dominio_id,
        dominio_nome,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE chosen_count = correct_count AND chosen_correct_count = correct_count)::int AS acertos
      FROM per_question
      WHERE correct_count > 0
      GROUP BY dominio_id, dominio_nome
      ORDER BY dominio_nome;
    `;
    const replacements = hasExamType
      ? { userId, examTypeId, fullQ: getFullExamQuestionCount() }
      : { userId, fullQ: getFullExamQuestionCount() };

    const rows = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

    const dominios = (rows || []).map(r => {
      const total = Number(r.total) || 1;
      const acertos = Number(r.acertos) || 0;
      const percent = Number(((acertos / total) * 100).toFixed(2));
      return {
        id: Number(r.dominio_id) || null,
        descricao: r.dominio_nome || String(r.dominio_id || 'Sem domínio'),
        total,
        acertos,
        percent
      };
    });

    return res.json({
      userId,
      examTypeId: hasExamType ? examTypeId : null,
      idExame: null,
      dominios
    });
  } catch (err) {
    return next(internalError('Erro interno', 'IND11_AGGREGATE_ERROR', err));
  }
}

// IND13 - Média ponderada por Task (agregado em todos os exames completos do usuário)
async function getPerformancePorTaskAgregado(req, res, next) {
  try {
    const user = req.user || {};
    // Resolve userId from middleware (`req.user.id`) or JWT-like `sub`, or `idUsuario` query fallback
    let userId = null;
    if (Number.isFinite(parseInt(user.id, 10))) userId = parseInt(user.id, 10);
    else if (Number.isFinite(parseInt(user.sub, 10))) userId = parseInt(user.sub, 10);
    else if (Number.isFinite(parseInt(req.query.idUsuario, 10))) userId = parseInt(req.query.idUsuario, 10);
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

    const examTypeId = parseInt(req.query.exam_type, 10);
    const hasExamType = Number.isFinite(examTypeId) && examTypeId > 0;

    const minTotalRaw = parseInt(req.query.min_total, 10);
    const minTotal = Number.isFinite(minTotalRaw) ? Math.min(Math.max(minTotalRaw, 1), 200) : 5;

    const dominioIdRaw = parseInt(req.query.dominio_id, 10);
    const dominioId = Number.isFinite(dominioIdRaw) && dominioIdRaw > 0 ? dominioIdRaw : null;

    const sql = `
      WITH attempts AS (
        SELECT a.id
        FROM exam_attempt a
        WHERE a.user_id = :userId
          AND a.finished_at IS NOT NULL
          AND (a.exam_mode = 'full' OR a.quantidade_questoes = :fullQ)
          ${hasExamType ? 'AND a.exam_type_id = :examTypeId' : ''}
      ),
      per_question AS (
        SELECT
          aq.id AS aqid,
          q.id_task AS task_id,
          t.numero AS task_numero,
          t.descricao AS task_descricao,
          t.peso AS task_peso,
          t.id_dominio AS dominio_id,
          dg.descricao AS dominio_nome,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true) AS chosen_count,
          COUNT(DISTINCT ro_all.id) FILTER (WHERE ro_all.iscorreta = true) AS correct_count,
          COUNT(DISTINCT aa.option_id) FILTER (WHERE aa.selecionada = true AND ro_chosen.iscorreta = true) AS chosen_correct_count
        FROM exam_attempt_question aq
        JOIN attempts a ON a.id = aq.attempt_id
        LEFT JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        JOIN questao q ON q.id = aq.question_id
        LEFT JOIN public."Tasks" t ON t.id = q.id_task
        LEFT JOIN dominiogeral dg ON dg.id = t.id_dominio
        LEFT JOIN respostaopcao ro_all ON ro_all.idquestao = aq.question_id
        LEFT JOIN respostaopcao ro_chosen ON ro_chosen.id = aa.option_id
        WHERE q.id_task IS NOT NULL
          ${dominioId != null ? 'AND t.id_dominio = :dominioId' : ''}
        GROUP BY aq.id, q.id_task, t.numero, t.descricao, t.peso, t.id_dominio, dg.descricao
      )
      SELECT
        task_id,
        task_numero,
        task_descricao,
        task_peso,
        dominio_id,
        dominio_nome,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE chosen_count = correct_count AND chosen_correct_count = correct_count)::int AS acertos
      FROM per_question
      WHERE correct_count > 0
      GROUP BY task_id, task_numero, task_descricao, task_peso, dominio_id, dominio_nome
      HAVING COUNT(*) >= :minTotal
      ORDER BY dominio_nome, task_numero;
    `;

    const baseReplacements = { userId, fullQ: getFullExamQuestionCount(), minTotal, ...(dominioId != null ? { dominioId } : {}) };
    const replacements = hasExamType
      ? { ...baseReplacements, examTypeId }
      : baseReplacements;

    const rows = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

    const tasks = (rows || []).map(r => {
      const total = Number(r.total) || 1;
      const acertos = Number(r.acertos) || 0;
      const percent = Number(((acertos / total) * 100).toFixed(2));

      const peso = r.task_peso != null ? Number(r.task_peso) : null;
      const pesoNum = (peso != null && Number.isFinite(peso) && peso > 0) ? peso : 0;
      const impactScore = Number((pesoNum * (100 - percent)).toFixed(4));

      const dominioNome = r.dominio_nome || (r.dominio_id != null ? `Domínio ${r.dominio_id}` : 'Sem domínio');
      const taskNumero = r.task_numero != null ? String(r.task_numero) : (r.task_id != null ? String(r.task_id) : '?');
      const taskDesc = r.task_descricao || '—';
      const descricao = `${dominioNome} - Task ${taskNumero} | - ${taskDesc} (n=${total})`;

      return {
        id: Number(r.task_id) || null,
        dominioId: r.dominio_id != null ? Number(r.dominio_id) : null,
        descricao,
        peso: peso != null && Number.isFinite(peso) ? peso : null,
        impactScore,
        total,
        acertos,
        percent
      };
    });

    return res.json({
      userId,
      examTypeId: hasExamType ? examTypeId : null,
      minTotal,
      dominioId,
      tasks
    });
  } catch (err) {
    return next(internalError('Erro interno', 'IND13_TASK_AGGREGATE_ERROR', err));
  }
}

// New: Extended history (up to 50 attempts) including full & quiz with completion status logic
async function getAttemptsHistoryExtended(req, res, next){
  try {
    const limit = 50;
    const userIdParam = parseInt(req.query.idUsuario, 10);
    const userId = Number.isFinite(userIdParam) && userIdParam > 0
      ? userIdParam
      : (req.user && Number.isFinite(parseInt(req.user?.sub, 10))
          ? parseInt(req.user.sub, 10)
          : (req.user && Number.isFinite(parseInt(req.user?.id, 10))
              ? parseInt(req.user.id, 10)
              : null));
    if (!userId) return next(badRequest('Usuário não identificado', 'USER_NOT_IDENTIFIED'));

    const sql = `
      WITH base AS (
        SELECT 
          a.id,
          a.user_id,
          a.exam_mode,
          a.quantidade_questoes,
          a.started_at,
          a.finished_at,
          a.corretas,
          a.total,
          a.score_percent,
          a.status
        FROM exam_attempt a
        WHERE a.user_id = :userId
        ORDER BY a.started_at DESC
        LIMIT ${limit}
      ), responded AS (
        SELECT aq.attempt_id, COUNT(DISTINCT aq.id) AS responded
        FROM exam_attempt_question aq
        JOIN exam_attempt_answer aa ON aa.attempt_question_id = aq.id
        WHERE aq.attempt_id IN (SELECT id FROM base)
        GROUP BY aq.attempt_id
      )
      SELECT b.*, COALESCE(r.responded,0) AS responded
      FROM base b
      LEFT JOIN responded r ON r.attempt_id = b.id
      ORDER BY b.started_at DESC;
    `;
    const rows = await sequelize.query(sql, { replacements: { userId }, type: sequelize.QueryTypes.SELECT });

    const items = (rows || []).map(r => {
      const total = Number(r.total) || 0;
      const responded = Number(r.responded) || 0;
      const corretas = Number(r.corretas) || 0;
      const examMode = r.exam_mode || null;
      const isFull = examMode === 'full';
      const respondedPct = total > 0 ? (responded / total * 100) : 0;
      const fullComplete = isFull && respondedPct >= 95;
      const quizComplete = !isFull && responded === total && total > 0;
      const status = isFull ? (fullComplete ? 'Completo' : 'Incompleto') : (quizComplete ? 'Completo' : 'Incompleto');
      const scorePercentRaw = r.score_percent != null ? Number(r.score_percent) : null;
      const showScore = status === 'Completo' && scorePercentRaw != null;
      const scoreDisplay = showScore ? `${scorePercentRaw.toFixed(2)}%` : '---';
      const titulo = isFull
        ? `Simulado completo ${total} questões`
        : `Quiz com ${total} questões`;
      return {
        id: r.id,
        date: r.started_at, // usar StartedAt conforme requisito
        titulo,
        tipo: isFull ? 'Completo' : 'Quiz',
        acertos: corretas,
        total,
        score: scoreDisplay,
        status,
        responded,
        respondedPercent: Number(respondedPct.toFixed(2))
      };
    });

    return res.json({ userId, limit, items });
  } catch(err){
    return next(internalError('Erro interno', 'ATTEMPTS_HISTORY_EXTENDED_ERROR', err));
  }
}

module.exports = { getOverview, getExamsCompleted, getApprovalRate, getFailureRate, getOverviewDetailed, getQuestionsCount, getAnsweredQuestionsCount, getTotalHours, getProcessGroupStats, getAreaConhecimentoStats, getAbordagemStats, getDetailsLast, getPerformancePorDominio, getAvgTimePerQuestion, getPerformancePorDominioAgregado, getPerformancePorTaskAgregado, getAttemptsHistoryExtended };
