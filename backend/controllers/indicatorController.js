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

module.exports = { getOverview, getExamsCompleted, getApprovalRate, getFailureRate, getOverviewDetailed, getQuestionsCount, getAnsweredQuestionsCount, getTotalHours };
