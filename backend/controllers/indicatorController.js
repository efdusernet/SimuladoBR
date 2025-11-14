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
    const sql = `SELECT COUNT(*)::int AS total
                 FROM exam_attempt
                 WHERE finished_at IS NOT NULL
                   AND (exam_mode = 'full' OR quantidade_questoes = :fullQ)
                   AND finished_at >= NOW() - (:days || ' days')::interval`;
    const rows = await sequelize.query(sql, { replacements: { days: String(days), fullQ: getFullExamQuestionCount() }, type: sequelize.QueryTypes.SELECT });
    const total = rows && rows[0] ? Number(rows[0].total) : 0;
    return res.json({ days, total });
  } catch (err) {
    return res.status(500).json({ message: 'Erro interno' });
  }
}

async function getApprovalRate(req, res) {
  try {
    const raw = parseInt(req.query.days, 10);
    const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 120) : 30;
    const sql = `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE score_percent >= 75)::int AS approved
                 FROM exam_attempt
                 WHERE finished_at IS NOT NULL
                   AND (exam_mode = 'full' OR quantidade_questoes = :fullQ)
                   AND finished_at >= NOW() - (:days || ' days')::interval`;
    const rows = await sequelize.query(sql, { replacements: { days: String(days), fullQ: getFullExamQuestionCount() }, type: sequelize.QueryTypes.SELECT });
    const total = rows && rows[0] ? Number(rows[0].total) : 0;
    const approved = rows && rows[0] ? Number(rows[0].approved) : 0;
    const ratePercent = total > 0 ? Number(((approved * 100) / total).toFixed(2)) : null;
    return res.json({ days, total, approved, ratePercent });
  } catch (err) {
    return res.status(500).json({ message: 'Erro interno' });
  }
}

async function getFailureRate(req, res) {
  try {
    const raw = parseInt(req.query.days, 10);
    const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 120) : 30;
    const sql = `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE score_percent < 75)::int AS failed
                 FROM exam_attempt
                 WHERE finished_at IS NOT NULL
                   AND (exam_mode = 'full' OR quantidade_questoes = :fullQ)
                   AND finished_at >= NOW() - (:days || ' days')::interval`;
    const rows = await sequelize.query(sql, { replacements: { days: String(days), fullQ: getFullExamQuestionCount() }, type: sequelize.QueryTypes.SELECT });
    const total = rows && rows[0] ? Number(rows[0].total) : 0;
    const failed = rows && rows[0] ? Number(rows[0].failed) : 0;
    const ratePercent = total > 0 ? Number(((failed * 100) / total).toFixed(2)) : null;
    return res.json({ days, total, failed, ratePercent });
  } catch (err) {
    return res.status(500).json({ message: 'Erro interno' });
  }
}

module.exports = { getOverview, getExamsCompleted, getApprovalRate, getFailureRate };
