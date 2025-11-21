#!/usr/bin/env node
// Script to purge abandoned exam attempts based on age and low progress threshold.
// Usage: node backend/scripts/purge_abandoned.js

const db = require('../models');
const policies = require('../config/examPolicies');
const { computeAttemptProgress } = require('../utils/examProgress');

async function run() {
  const now = Date.now();
  const cutoffMs = now - policies.PURGE_AFTER_DAYS * 86400000;
  const batchLimit = policies.BATCH_LIMIT || 250;

  // Load abandoned attempts (status=abandoned) ordered oldest first
  const attempts = await db.ExamAttempt.findAll({
    where: { Status: 'abandoned' },
    order: [['StartedAt', 'ASC']],
    limit: batchLimit,
  });

  let inspected = 0;
  let purged = 0;

  for (const attempt of attempts) {
    inspected++;
    const startedAt = attempt.StartedAt || new Date();
    const startedMs = new Date(startedAt).getTime();
    if (startedMs > cutoffMs) continue; // younger than purge age

    const progress = await computeAttemptProgress(db, attempt.Id);
    if (progress.respondedPercent >= policies.PURGE_LOW_PROGRESS_PERCENT) continue; // keep attempts with sufficient progress

    // Snapshot data for purge log
    const snapshot = {
      attempt_id: attempt.Id,
      user_id: attempt.UserId || null,
      exam_type_id: attempt.ExamTypeId || null,
      exam_mode: attempt.ExamMode || null,
      quantidade_questoes: attempt.QuantidadeQuestoes || null,
      responded_count: progress.respondedCount,
      responded_percent: progress.respondedPercent,
      status_before: attempt.Status,
      status_reason_before: attempt.StatusReason || null,
      started_at: attempt.StartedAt || null,
      finished_at: attempt.FinishedAt || null,
      purge_reason: 'policy',
      meta: attempt.Meta || null,
    };

    await db.sequelize.transaction(async (t) => {
      // Insert log
      await db.ExamAttemptPurgeLog.create(snapshot, { transaction: t });
      // Delete answers
      const aqRows = await db.ExamAttemptQuestion.findAll({ where: { AttemptId: attempt.Id }, attributes: ['Id'], transaction: t });
      const aqIds = aqRows.map(r => r.Id);
      if (aqIds.length) {
        await db.ExamAttemptAnswer.destroy({ where: { AttemptQuestionId: aqIds }, transaction: t });
      }
      // Delete questions
      await db.ExamAttemptQuestion.destroy({ where: { AttemptId: attempt.Id }, transaction: t });
      // Delete attempt
      await db.ExamAttempt.destroy({ where: { Id: attempt.Id }, transaction: t });
    });

    purged++;
  }

  console.log(JSON.stringify({ inspected, purged }, null, 2));
  await db.sequelize.close();
}

run().catch(err => { console.error(err); process.exit(1); });
