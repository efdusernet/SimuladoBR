// Service to update per-user daily exam attempt stats.
// Uses PostgreSQL ON CONFLICT for atomic increments.

const { Op } = require('sequelize');

function toDateKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10); // YYYY-MM-DD
}

module.exports = function buildUserStatsService(db) {
  const sequelize = db.sequelize;

  async function upsertIncrement(userId, dateKey, patch) {
    // Build dynamic SETs for incrementing counts atomically.
    const sets = [];
    if (patch.started) sets.push('started_count = exam_attempt_user_stats.started_count + ' + Number(patch.started));
    if (patch.finished) sets.push('finished_count = exam_attempt_user_stats.finished_count + ' + Number(patch.finished));
    if (patch.abandoned) sets.push('abandoned_count = exam_attempt_user_stats.abandoned_count + ' + Number(patch.abandoned));
    if (patch.timeout) sets.push('timeout_count = exam_attempt_user_stats.timeout_count + ' + Number(patch.timeout));
    if (patch.lowProgress) sets.push('low_progress_count = exam_attempt_user_stats.low_progress_count + ' + Number(patch.lowProgress));
    if (patch.purged) sets.push('purged_count = exam_attempt_user_stats.purged_count + ' + Number(patch.purged));
    let avgScoreExpr = null;
    if (patch.scorePercent != null) {
      // Recompute average: newAvg = (oldAvg * finished_before + score) / finished_after
      // We need finished_after -> old finished_count + (patch.finished || 0)
      // Use CASE for null avg.
      const scoreVal = Number(patch.scorePercent);
      const incFinished = Number(patch.finished || 0);
      avgScoreExpr = `avg_score_percent = CASE WHEN exam_attempt_user_stats.finished_count + ${incFinished} = 0 THEN NULL ELSE \n        ROUND(((COALESCE(exam_attempt_user_stats.avg_score_percent,0) * exam_attempt_user_stats.finished_count) + ${scoreVal}) / (exam_attempt_user_stats.finished_count + ${incFinished}), 3) END`;
    }
    if (!sets.length && !avgScoreExpr) return; // nothing to update
    if (avgScoreExpr) sets.push(avgScoreExpr);
    sets.push('updated_at = NOW()');
    const updateSql = sets.join(', ');

    const sql = `INSERT INTO exam_attempt_user_stats (user_id, date, started_count, finished_count, abandoned_count, timeout_count, low_progress_count, purged_count, avg_score_percent)\n      VALUES (:uid, :date, 0, 0, 0, 0, 0, 0, NULL)\n      ON CONFLICT (user_id, date) DO UPDATE SET ${updateSql}`;
    await sequelize.query(sql, { replacements: { uid: userId, date: dateKey } });
  }

  async function incrementStarted(userId, when = new Date()) {
    return upsertIncrement(userId, toDateKey(when), { started: 1 });
  }
  async function incrementFinished(userId, scorePercent, when = new Date()) {
    return upsertIncrement(userId, toDateKey(when), { finished: 1, scorePercent });
  }
  async function incrementAbandoned(userId, reason, when = new Date()) {
    const patch = { abandoned: 1 };
    if (reason === 'timeout_inactivity') patch.timeout = 1; else if (reason === 'abandoned_low_progress') patch.lowProgress = 1;
    return upsertIncrement(userId, toDateKey(when), patch);
  }
  async function incrementPurged(userId, when = new Date()) {
    return upsertIncrement(userId, toDateKey(when), { purged: 1 });
  }

  async function getDailyStats(userId, days = 30) {
    const fromDate = new Date(Date.now() - (days - 1) * 86400000);
    const dateKey = toDateKey(fromDate);
    const rows = await db.ExamAttemptUserStats.findAll({
      where: { UserId: userId, Date: { [Op.gte]: dateKey } },
      order: [['Date', 'ASC']]
    });
    return rows.map(r => {
      const started = Number(r.StartedCount || 0);
      const finished = Number(r.FinishedCount || 0);
      const abandoned = Number(r.AbandonedCount || 0);
      const purged = Number(r.PurgedCount || 0);
      const timeout = Number(r.TimeoutCount || 0);
      const lowProgress = Number(r.LowProgressCount || 0);
      const avgScore = r.AvgScorePercent == null ? null : Number(r.AvgScorePercent);
      return {
        date: r.Date,
        started,
        finished,
        abandoned,
        timeout,
        lowProgress,
        purged,
        avgScorePercent: avgScore,
        abandonRate: started > 0 ? abandoned / started : 0,
        completionRate: started > 0 ? finished / started : 0,
        purgeRate: abandoned > 0 ? purged / abandoned : 0,
      };
    });
  }

  async function getSummary(userId, days = 30) {
    const daily = await getDailyStats(userId, days);
    let started = 0, finished = 0, abandoned = 0, purged = 0, timeout = 0, lowProgress = 0;
    let scoreSum = 0, scoreCount = 0;
    daily.forEach(d => {
      started += d.started;
      finished += d.finished;
      abandoned += d.abandoned;
      purged += d.purged;
      timeout += d.timeout;
      lowProgress += d.lowProgress;
      if (d.avgScorePercent != null && d.finished > 0) {
        // Weighted by finished count of that day
        scoreSum += d.avgScorePercent * d.finished;
        scoreCount += d.finished;
      }
    });
    const avgScorePercent = scoreCount > 0 ? Number((scoreSum / scoreCount).toFixed(3)) : null;
    return {
      periodDays: days,
      started,
      finished,
      abandoned,
      timeout,
      lowProgress,
      purged,
      avgScorePercent,
      abandonRate: started > 0 ? abandoned / started : 0,
      completionRate: started > 0 ? finished / started : 0,
      purgeRate: abandoned > 0 ? purged / abandoned : 0,
    };
  }

  return {
    incrementStarted,
    incrementFinished,
    incrementAbandoned,
    incrementPurged,
    getDailyStats,
    getSummary,
  };
};
